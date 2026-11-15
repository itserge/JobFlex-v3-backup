"use client";
// DECK ESTIMATOR — VARIANT 5: "START FROM THE DECK PEOPLE ASK FOR" (2026-10-18).
//
// The bet: most jobs are one of a handful of decks. The page opens on a gallery of those decks as pictures, each with
// its usual size and what it comes to on this shop's rate book at this address (deck-v5-gallery.tsx). Picking one
// lands on a two-pane editor: the deck standing in 3D on the left; on the right only what usually changes — the size,
// the height, the boards, the rails, the stairs — as large controls under the live price, and every rarer choice
// (the kind, the shape and levels, the house wall plan, the site, the structure, the trim, the roof, the lights) in a
// named "More" that says what is set inside it while closed. The code checks are one status line that opens. The
// finish row stays in reach: Make proposal (the one blue button), Save draft, Send to client. Work opened again
// (`?draft=` / `?proposal=`) skips the gallery.
//
// Logic copied from deck-studio.tsx (the live studio, 2026-10-04 → 10-17): the settling, the patching, the house and
// deck agreeing, the 3D's build-up / x-ray / night / connections / picking / editing / placing, the drafts that save
// themselves, the client returns, the linked proposal and its update, the photo flow (dormant there and here,
// PHOTO_ENABLED), the custom products, the own items, the rate book. Its comments' intent is kept where it was copied.

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { resolveMarket, parseStateZip, type MarketSnapshot } from "@/lib/fence/market";
import { leftEndPatch } from "@/lib/deck/frontByHand";
import { bowPatch } from "@/lib/deck/curve";
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
  STRUCTURES,
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
  type DeckPhoto,
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
import { deckElevation, defaultPlacement } from "@/lib/deck/elevation";
import { BOM_STEP_LABEL, FIXTURE_RATE, type BomStep } from "@/lib/deck/takeoff";
import { STORE_SURVEY, storePrice } from "@/lib/deck/storePrices";
import { DECK_RATES, DECK_RATE_GROUP_LABEL, deckRate, sanitizeDeckRateBook, type DeckRateBook, type DeckRateGroup } from "@/lib/deck/rates";
import { convertDeckEstimateToProposal, updateDeckProposal, deckPhotoHref, deleteDeckDraft, listDeckDrafts, loadDeckDraft, readDeckPhoto, readDeckSite, saveDeckDraft, saveDeckRateBook, uploadDeckPhoto, type DeckDraftRow, type ReturnedClientDesign } from "@/actions/deckEstimator";
import { deckClientInbox } from "@/actions/deckClientDesign";
import { jobLine, type ClientLinkRow } from "@/lib/deck/clientDesign";
import { addDoor, addJog, addScaleLine, blankRead, fitPhoto, fitSummary, markedRead, removeDoor, removeJog, removeScaleLine, setJog, setScaleLength, shapeWithOffer, type FitDeck, type PhotoFit, type WallRead, rectifyPlan, transformPlaced, transformRead, wallQuadFromRead, type Placed, type Quad, autoRectify, wallExtent } from "@/lib/deck/photoFit";
import { HOUSE_LIMITS, HOUSE_ROOF_LABEL, HOUSE_ROOFS, QUICK_WALLS, QUICK_WALL_LABEL, ROOF_COLOURS, SIDINGS, deckShapeForHouse, houseForShape, houseNotes, houseWords, nextJogId, quickWall, quickWallOf, stepWords, wallWords, type HouseDesign, type HouseJog, type HouseRoof, wallHighlight, type WallFocus } from "@/lib/deck/house";
import { DECK_LOCK_WORDS, PROPOSAL_STATUS_WORDS, type LinkedDeckProposal } from "@/lib/deck/proposalEdit";
import { DECK_SAMPLES, type DeckSample } from "@/lib/deck/samples";
import { reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import { autoFixDesign, autoFixable, resizes, roofResizes, settleDesign } from "@/lib/deck/settle";
import type { DeckBackdrop, DeckEdit, DeckPick, SceneHighlight } from "@/components/estimator/deck/DeckModel3D";
import { fieldLight, type FieldFocus } from "@/lib/deck/fieldParts";
import { HouseWallPlan } from "@/components/v3/deck-estimator-blueprint/house-wall-plan";
import { DeckPlan, type PlanEdgeHit, nearestStairEdge } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import { DeckPhotoView, cropPhoto, shrinkPhoto, straightenPhoto, trimLetterbox } from "@/components/v3/deck-estimator-blueprint/deck-photo";
import { CUSTOM, CUSTOM_LABEL, Chevron, CustomBox, Field, FieldScope, More, NameInput, NumberInput, Scope, Seg, Stepper, Toggle, ago, cx, feetText, intText, money, parseFeet, parseInches, priceShow, priceText, type FieldScopeValue } from "./deck-v5-controls";
import { DeckGallery, type PricedSample } from "./deck-v5-gallery";
import { SendToClient } from "./deck-v5-send";
import "./deck-variant-5.css";

const DeckModel3D = dynamic(() => import("@/components/estimator/deck/DeckModel3D").then((m) => m.DeckModel3D), {
  ssr: false,
  loading: () => <div className="v5-view-wait">Setting up the 3D view…</div>,
});

/** This variant's own address: links to a draft open here, not in the live studio. */
const HERE = "/dashboard/deck-v5";

/** The photo of the house is out (owner, 2026-10-11: "let's not use that picture at all — the 3D model, and you draw the house"); its flow stays here, dormant, as in the live studio. */
const PHOTO_ENABLED = false;

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
/** Fixtures a tap adds, in the order a contractor usually thinks of them. */
const FIXTURE_CHIPS: FixtureKind[] = ["led-strip", "post-cap", "step-light", "string-light", "sconce", "ceiling-light", "chandelier", "fan", "outlet", "heater", "flood"];
const FIXTURE_SHORT: Record<FixtureKind, string> = { "led-strip": "LED strip", "post-cap": "Post caps", "step-light": "Step lights", "string-light": "String lights", sconce: "Sconce", "ceiling-light": "Ceiling light", chandelier: "Chandelier", fan: "Fan", outlet: "Outlet", heater: "Heater", flood: "Security light" };
/** Good / Better / Best: the boards and the rail each tier stands on. */
const TIERS: ReadonlyArray<{ id: "good" | "better" | "best"; name: string; decking: (state: string | null) => string; rail: DeckDesign["rail"]["type"]; words: string }> = [
  { id: "good", name: "Good", decking: (st) => treatedDecking(st), rail: "treated", words: "Treated wood boards and rail" },
  { id: "better", name: "Better", decking: () => "composite-better", rail: "composite", words: "Capped composite, composite rail" },
  { id: "best", name: "Best", decking: () => "composite-best", rail: "aluminum", words: "Premium composite, aluminum rail" },
];

type Placing = null | { kind: "stair" } | { kind: "fixture"; id: string };

export interface OpenedDesign {
  design: DeckDesign;
  address: string | null;
  title: string;
  draftId: string | null;
  from: "draft" | "proposal";
  /** The saved proposal this design is on: the studio updates it in place (2026-10-12). */
  proposal?: LinkedDeckProposal | null;
  /** A design the client sent back through their link (2026-10-13): their words ride over it. */
  client?: ReturnedClientDesign | null;
}

/** An internal link that moves with the router (never a hard load), a modified click still opening a new tab. */
function useGo() {
  const router = useRouter();
  return React.useCallback(
    (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      router.push(href as Route);
    },
    [router],
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function DeckV5Studio({ initialBook, homeState, initialAddress, clientId, adminPreview = false, opened = null }: { initialBook: DeckRateBook; homeState: string | null; initialAddress?: string; clientId?: string; adminPreview?: boolean; opened?: OpenedDesign | null }) {
  const router = useRouter();
  const go = useGo();
  const [address, setAddress] = React.useState(initialAddress ?? "");
  const [addressDraft, setAddressDraft] = React.useState(initialAddress ?? "");
  const market: MarketSnapshot = React.useMemo(() => {
    const parsed = parseStateZip(address);
    return parsed.state || parsed.zip ? resolveMarket({ address }) : resolveMarket({ state: homeState });
  }, [address, homeState]);
  const site = React.useMemo(() => siteFromAddress(address, homeState), [address, homeState]);
  const [design, setDesign] = React.useState<DeckDesign>(() => {
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

  /* ── the two views of this variant: the gallery first, unless work is opened again ── */
  const [stage, setStage] = React.useState<"gallery" | "editor">(opened ? "editor" : "gallery");
  /** The gallery was opened from the editor: "Back to your deck" returns without picking. */
  const [galleryFromEditor, setGalleryFromEditor] = React.useState(false);
  const toEditor = () => {
    setStage("editor");
    setGalleryFromEditor(false);
    if (typeof window !== "undefined") requestAnimationFrame(() => document.querySelector("[data-v5-root]")?.scrollIntoView({ block: "start" }));
  };
  const toGallery = () => {
    setGalleryFromEditor(true);
    setStage("gallery");
    if (typeof window !== "undefined") requestAnimationFrame(() => document.querySelector("[data-v5-root]")?.scrollIntoView({ block: "start" }));
  };

  // SETTLING (owner, 2026-10-10): a size change re-runs the tables (lib/deck/settle) and applies the member-sizing fixes
  // the checks would offer, so what stands on screen is never a frame the tables refuse.
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
        // picked in the shape puts its step in the wall; a rectangle takes that step away.
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
  const viewerRef = React.useRef<HTMLElement>(null);
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
  // A SAMPLE TO START FROM (lib/deck/samples): the sample's kind, shape, height, rails, stairs, levels and roof laid over
  // the contractor's own address, site, house and lumber, settled to the tables like any resize. It stays marked as long
  // as the design is the one the sample made.
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
  /** The plain deck of the gallery's last card: the stock deck's size, height, rail and stair over the job, like a sample. */
  const blankPatch = React.useMemo<DeckPatch>(() => {
    const base = defaultDeckDesign({ state: market.state || homeState, frostIn: market.frostIn });
    return { structure: "deck", floor: "deck", placement: base.placement, shape: base.shape, heightIn: base.heightIn, rail: { type: base.rail.type, infill: "auto" }, stairs: base.stairs, lower: { on: false }, spa: { on: false } };
  }, [market.state, market.frostIn, homeState]);
  const applyBlank = () => {
    dirty.current = true;
    let next = applyDeckPatch(design, blankPatch);
    const h2 = houseForShape(next.house, next.shape);
    if (h2 !== next.house) next = applyDeckPatch(next, { house: h2 });
    setDesign(settle(next));
    setApplied(null);
  };

  const pkg = React.useMemo(() => priceDeck(design, { rates: book, market }), [design, book, market]);
  const structure = pkg.structure;
  const frame = pkg.frame;
  const roof = pkg.roof;
  const checks = React.useMemo(() => deckChecks(structure), [structure]);
  const summary = checkSummary(checks);
  // AUTO-FIX (owner, 2026-10-11): every failure's fix and the warnings the code answers, in one tap.
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

  /* ── THE GALLERY'S PRICES: every sample over this job, on this rate book, settled as a pick would be ── */
  const priced = React.useMemo<{ list: PricedSample[]; blank: number } | null>(() => {
    if (stage !== "gallery") return null;
    const over = (p: DeckPatch) => {
      let next = applyDeckPatch(design, p);
      const h2 = houseForShape(next.house, next.shape);
      if (h2 !== next.house) next = applyDeckPatch(next, { house: h2 });
      return priceDeck(settleDesign(next, { rates: book, market }).design, { rates: book, market }).subtotal;
    };
    const list = DECK_SAMPLES.map((sample) => {
      const facts = sample.facts.split(" · ");
      return { sample, price: over(sample.patch), size: facts[0] ?? "", detail: facts[1] ?? "" };
    });
    return { list, blank: over(blankPatch) };
  }, [stage, design, book, market, blankPatch]);

  // THE WALL FIELD, SHOWN IN 3D (owner, 2026-10-12): the field typed in — or the one the pointer is over — lights its part.
  const [wallFocus, setWallFocus] = React.useState<WallFocus | null>(null);
  const [wallHover, setWallHover] = React.useState<WallFocus | null>(null);
  const [fieldFocus, setFieldFocus] = React.useState<FieldFocus | null>(null);
  const [fieldHover, setFieldHover] = React.useState<FieldFocus | null>(null);
  const sameField = (a: FieldFocus | null, b: FieldFocus) => !!a && JSON.stringify(a) === JSON.stringify(b);
  const rootScope = React.useMemo<FieldScopeValue>(
    () => ({
      where: {},
      light: (f, how) => (how === "focus" ? setFieldFocus(f) : setFieldHover(f)),
      unlight: (f, how) => (how === "focus" ? setFieldFocus((x) => (sameField(x, f) ? null : x)) : setFieldHover((x) => (sameField(x, f) ? null : x))),
    }),
    [],
  );
  const lightsFor = (f: WallFocus) => ({
    on: (how: "focus" | "hover") => (how === "focus" ? setWallFocus(f) : setWallHover(f)),
    off: (how: "focus" | "hover") => (how === "focus" ? setWallFocus((x) => (x && JSON.stringify(x) === JSON.stringify(f) ? null : x)) : setWallHover((x) => (x && JSON.stringify(x) === JSON.stringify(f) ? null : x))),
  });
  // WORKING IN THE SHAPE IS QUIET (owner, 2026-10-12): the drawing of the wall lights nothing, and a press in it puts out
  // whatever light is still on (a box typed in a moment ago is let go of first, its number committed on the way out).
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
  const elevation = React.useMemo(() => deckElevation(scene), [scene]);
  const wall = wallType(design.wall);
  const withDeck = hasDeck(design);
  const withRoof = hasRoof(design);
  const what = STRUCTURE_LABEL[design.structure];
  const tiers = React.useMemo(() => {
    if (!withDeck) return null;
    const st = market.state || homeState;
    return TIERS.map((t) => {
      // The tier's own railing: none where none is needed and none is drawn, else the tier's. "This one" only when the
      // deck as drawn IS the tier — boards and railing.
      const railT = design.rail.type === "none" && !structure.rails.required ? "none" : t.rail;
      const variant = applyDeckPatch(design, { decking: { product: t.decking(st) }, rail: { type: railT }, custom: { decking: undefined } });
      const p = priceDeck(variant, { rates: book, market });
      return { ...t, product: t.decking(st), subtotal: p.subtotal, perSqFt: p.pricePerSqFt, current: !design.custom.decking && design.decking.product === t.decking(st) && design.rail.type === railT };
    });
  }, [design, book, market, homeState, withDeck, structure.rails.required]);

  /* ── the 3D's build-up, night, connections, picking ── */
  const [view, setView] = React.useState<"3d" | "plan" | "wall" | "photo">("3d");
  // THE DRAWING, LARGE (owner, 2026-10-11: "more space for drawing"): the house wall drawing in the viewer.
  const openWallLarge = React.useCallback(() => {
    setView("wall");
    document.querySelector("[data-deck-viewer]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
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
  const [editing, setEditing] = React.useState(false);
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
        case "width-left": {
          // (2026-11-14) The deck's LEFT end: the house stays put, the left part of a front in parts takes the change.
          const moved = leftEndPatch(design, e.value);
          if (moved) patch(moved);
          break;
        }
        case "bow": {
          // (2026-11-15) The knob on the arc: the side bows out as far as it is pulled, to 3 in.
          const bowed = bowPatch(design, e.id, e.value);
          if (bowed) patch(bowed);
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
          // The knob at the peak: whole pitches only, from the list the studio offers.
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

  const onPick = React.useCallback(
    (pick: DeckPick | null, kind: "hover" | "click") => {
      if (kind === "hover") {
        setHoverPick(pick);
        return;
      }
      if (placing?.kind === "stair") {
        // A click anywhere on the deck takes its nearest open edge (owner, 2026-10-11).
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
    },
    [placing, setFixtures, setStairs, structure],
  );
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
  // THE PROPOSAL IT WAS OPENED FROM (owner, 2026-10-12): "Update the proposal" re-prices that one rather than making a second.
  const [linked, setLinked] = React.useState<LinkedDeckProposal | null>(opened?.proposal ?? null);
  const linkedId = linked?.id ?? null;
  const designSig = React.useMemo(() => JSON.stringify([design, address]), [design, address]);
  /** The design the proposal holds, as a signature; null when not known. */
  const [proposalSig, setProposalSig] = React.useState<string | null>(() => (opened?.from === "proposal" ? designSig : null));
  const [updated, setUpdated] = React.useState<{ at: string; kept: number; titleKept: boolean; scopeKept: boolean } | null>(null);
  const [confirmAt, setConfirmAt] = React.useState<"top" | "bottom" | null>(null);
  /** Where the last proposal action was asked from: its error shows there. */
  const [actAt, setActAt] = React.useState<"top" | "bottom">("bottom");
  /** The design differs from the one on the proposal. */
  const behind = !!linked && designSig !== proposalSig;
  // THE CLIENT'S RETURN (owner, 2026-10-13): the design may be one a client sent back; returns nobody has opened bloom.
  const [fromClient, setFromClient] = React.useState<ReturnedClientDesign | null>(opened?.client ?? null);
  const clientToken = fromClient?.token ?? null;
  const [inbox, setInbox] = React.useState<Array<ClientLinkRow & { url: string }>>([]);
  // "Later" puts a return aside in this browser until it is sent again (the key carries the send's time).
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
  /** Returns to show: not the one on screen, not one dismissed here. */
  const inboxNew = inbox.filter((l) => l.token !== clientToken && !inboxSeen.has(`${l.token}:${l.sentAt ?? ""}`));
  const saveDraft = React.useCallback(async () => {
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
    const t = setTimeout(() => void saveDraft(), 1500);
    return () => clearTimeout(t);
  }, [saveDraft]);
  const saveNow = () => {
    dirty.current = true;
    void saveDraft();
  };
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
    setConfirmAt(null);
    setFromClient(res.client);
    setApplied(null);
    if (res.client) setInbox((list) => list.filter((l) => l.token !== res.client?.token));
    setStage("editor");
    setGalleryFromEditor(false);
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
    setConfirmAt(null);
    setFromClient(null);
    setApplied(null);
    setGalleryFromEditor(false);
    setStage("gallery");
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

  /* ── the photo of the house (dormant: PHOTO_ENABLED) ── */
  const [photoHref, setPhotoHref] = React.useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const pickPhoto = () => fileRef.current?.click();
  const [photoStage, setPhotoStage] = React.useState<string | null>(null);
  const [photoNote, setPhotoNote] = React.useState<string | null>(null);
  const lastFile = React.useRef<File | null>(null);
  const fitDeck = React.useMemo<FitDeck>(() => ({ shape: design.shape, depthFt: design.shape.depthFt, elevWidthFt: elevation.widthFt, elevHeightFt: elevation.heightFt, elevLeftFt: elevation.leftFt }), [design.shape, elevation]);
  // THE SMART FIT (owner, 2026-10-10): shrunk, its black bands cut, read once by the vision model, cropped to the wall
  // and placed by the read — then saved. A read that fails still saves the picture, centred, and says why.
  const placePhoto = async (file: File) => {
    setPhotoBusy(true);
    setPhotoError(null);
    setPhotoNote(null);
    try {
      lastFile.current = file;
      setPhotoStage("Reading the picture…");
      const small = await shrinkPhoto(file);
      const clean = await trimLetterbox(small.file, small.w, small.h);
      setPhotoStage("Finding the wall…");
      const readForm = new FormData();
      readForm.set("file", clean.file);
      const read = await readDeckPhoto(readForm);
      let toUpload: { file: File; w: number; h: number } = clean;
      let placed = defaultPlacement();
      let fit: PhotoFit | null = null;
      let wallRead: WallRead | null = null;
      let before: NonNullable<DeckPhoto["straightened"]>["before"] | null = null;
      let quad: Quad | null = null;
      let autoNote: string | null = null;
      if (read.ok) {
        wallRead = read.read;
        const plan = autoRectify(read.read, clean.w, clean.h);
        let warped: { file: File; w: number; h: number } | null = null;
        if (plan) {
          setPhotoStage("Straightening the picture…");
          warped = await straightenPhoto(clean.file, plan.H, { w: plan.w, h: plan.h }, { w: clean.w, h: clean.h }).catch(() => null);
        }
        if (plan && warped) {
          const fit0 = fitPhoto(read.read, fitDeck, design.heightIn, clean.w, clean.h);
          const cut0 = await cropPhoto(clean.file, fit0.crop, clean.w, clean.h);
          const form0 = new FormData();
          form0.set("file", cut0.file);
          form0.set("w", String(cut0.w));
          form0.set("h", String(cut0.h));
          const res0 = await uploadDeckPhoto(form0);
          if (res0.ok) before = { url: res0.url, w: res0.w, h: res0.h, placed: fit0.placed, fit: fitSummary(fit0, read.read) };
          wallRead = transformRead(read.read, plan.H, clean.w, clean.h, warped.w, warped.h);
          quad = wallQuadFromRead(read.read);
          fit = fitPhoto(wallRead, fitDeck, design.heightIn, warped.w, warped.h);
          toUpload = await cropPhoto(warped.file, fit.crop, warped.w, warped.h);
          autoNote = `The shot was ${plan.obliquePct}% off square — the picture was straightened so the wall stands true and the windows sit where they are. "Original picture" brings back the one you took.`;
        } else {
          fit = fitPhoto(read.read, fitDeck, design.heightIn, clean.w, clean.h);
          toUpload = await cropPhoto(clean.file, fit.crop, clean.w, clean.h);
        }
        placed = fit.placed;
      } else setPhotoNote(read.error);
      setPhotoStage("Saving the picture…");
      const form = new FormData();
      form.set("file", toUpload.file);
      form.set("w", String(toUpload.w));
      form.set("h", String(toUpload.h));
      const res = await uploadDeckPhoto(form);
      if (!res.ok) {
        setPhotoError(res.error);
        return;
      }
      setPhotoHref(res.href);
      patch({ photo: { url: res.url, w: res.w, h: res.h, placed, fit: fit && wallRead ? fitSummary(fit, wallRead) : null, straightened: before && quad ? { quad, before } : null } });
      if (autoNote) setPhotoNote(autoNote);
      setView("photo");
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "The picture could not be read.");
    } finally {
      setPhotoBusy(false);
      setPhotoStage(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const onPhotoFile = (file: File | null) => {
    if (file) void placePhoto(file);
  };
  const readPhotoAgain = async () => {
    if (!design.photo || photoBusy) return;
    let file = lastFile.current;
    if (!file) {
      const href = photoHref ?? (await deckPhotoHref(design.photo.url).catch(() => null));
      if (!href) return;
      try {
        const blob = await fetch(href).then((res) => (res.ok ? res.blob() : null));
        if (!blob) return;
        file = new File([blob], "house.jpg", { type: blob.type || "image/jpeg" });
      } catch {
        return;
      }
    }
    await placePhoto(file);
  };
  const refitPhoto = () => {
    const p = design.photo;
    if (!p || photoBusy) return;
    const read = p.fit?.read;
    if (!read) {
      void readPhotoAgain();
      return;
    }
    const fit = fitPhoto(read, fitDeck, design.heightIn, p.w, p.h, { recrop: false });
    patch({ photo: { ...p, placed: fit.placed, fit: fitSummary(fit, read) } });
  };
  const refitAfter = React.useRef(false);
  const applyOffer = () => {
    const offer = design.photo?.fit?.offer;
    if (!offer) return;
    refitAfter.current = true;
    patch({ shape: shapeWithOffer(design.shape, offer) });
  };
  React.useEffect(() => {
    if (!refitAfter.current) return;
    refitAfter.current = false;
    queueMicrotask(refitPhoto);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the shape the offer set
  }, [fitDeck]);
  React.useEffect(() => {
    const url = design.photo?.url;
    if (!url || photoHref) return;
    let gone = false;
    deckPhotoHref(url)
      .then((href) => {
        if (!gone && href) setPhotoHref(href);
      })
      .catch(() => null);
    return () => {
      gone = true;
    };
  }, [design.photo?.url, photoHref]);
  const [showHouse, setShowHouse] = React.useState(true);
  const backdrop = React.useMemo<DeckBackdrop | null>(() => {
    const p = design.photo;
    if (!PHOTO_ENABLED || !showHouse || !p?.placed || !photoHref) return null;
    return { href: photoHref, w: p.w, h: p.h, placed: p.placed, elevWidthFt: elevation.widthFt, elevLeftFt: elevation.leftFt, jogs: (p.fit?.read?.jogs ?? []).map((j) => ({ x: j.x, dir: j.dir, depthFt: j.depthFt })), standoffFt: scene.house ? 0 : 16, wall: p.fit?.read ? wallExtent(p.fit.read) : null };
  }, [design.photo, photoHref, elevation.widthFt, elevation.leftFt, showHouse, scene.house]);
  const [marking, setMarking] = React.useState(false);
  const markRead: WallRead = design.photo?.fit?.read ?? blankRead();
  const applyRead = (read: WallRead) => {
    const p = design.photo;
    if (!p) return;
    const marked = markedRead(read);
    const fit = fitPhoto(marked, fitDeck, design.heightIn, p.w, p.h, { recrop: false, fallback: p.placed ?? defaultPlacement(), hand: true });
    patch({ photo: { ...p, placed: fit.placed, fit: fitSummary(fit, marked, true) } });
  };
  const [straightening, setStraightening] = React.useState(false);
  const [corners, setCorners] = React.useState<Quad | null>(null);
  const [wallWidthFt, setWallWidthFt] = React.useState<number | null>(null);
  const startStraighten = () => {
    if (!design.photo) return;
    setCorners(wallQuadFromRead(design.photo.fit?.read ?? null));
    setMarking(false);
    setStraightening(true);
    setView("photo");
  };
  const cancelStraighten = () => {
    setStraightening(false);
    setCorners(null);
  };
  const straightenNow = async () => {
    const p = design.photo;
    if (!p || !corners || photoBusy) return;
    const read = p.fit?.read ?? null;
    const plan = rectifyPlan(corners, read, p.w, p.h, { wallWidthFt });
    if (!plan) {
      setPhotoError("The four corners do not make a wall: the two top corners above the two bottom ones, left of right, each a little apart.");
      return;
    }
    setPhotoBusy(true);
    setPhotoError(null);
    setPhotoNote(null);
    try {
      setPhotoStage("Straightening the picture…");
      const href = photoHref ?? (await deckPhotoHref(p.url).catch(() => null));
      const blob = href ? await fetch(href).then((res) => (res.ok ? res.blob() : null)).catch(() => null) : null;
      if (!blob) throw new Error("The picture could not be fetched to straighten it — try again.");
      const warped = await straightenPhoto(new File([blob], "house.jpg", { type: blob.type || "image/jpeg" }), plan.H, { w: plan.w, h: plan.h }, { w: p.w, h: p.h });
      if (!warped) throw new Error("The picture could not be straightened.");
      setPhotoStage("Saving the picture…");
      const form = new FormData();
      form.set("file", warped.file);
      form.set("w", String(warped.w));
      form.set("h", String(warped.h));
      const res = await uploadDeckPhoto(form);
      if (!res.ok) {
        setPhotoError(res.error);
        return;
      }
      const read2 = read ? transformRead(read, plan.H, p.w, p.h, warped.w, warped.h) : null;
      let placed: Placed = p.placed ? transformPlaced(p.placed, plan.H, p.w, p.h, warped.w, warped.h) : defaultPlacement();
      let fit: DeckPhoto["fit"] = null;
      if (read2) {
        const f = fitPhoto(read2, fitDeck, design.heightIn, warped.w, warped.h, { recrop: false, fallback: placed, hand: p.fit?.hand });
        placed = f.placed;
        fit = fitSummary(f, read2, p.fit?.hand ?? false);
      }
      setPhotoHref(res.href);
      patch({ photo: { url: res.url, w: res.w, h: res.h, placed, fit, straightened: { quad: corners, before: { url: p.url, w: p.w, h: p.h, placed: p.placed, fit: p.fit ?? null } } } });
      setStraightening(false);
      setCorners(null);
      setPhotoNote(plan.by === "edges" ? `Straightened from the corners alone (the shot was ${plan.obliquePct}% off square). For the exact width, go back to the original, type the wall's width or draw a measure across it, and straighten again.` : plan.by === "width" ? "Straightened to the width you typed." : "Straightened to the measure you drew.");
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "The picture could not be straightened.");
    } finally {
      setPhotoBusy(false);
      setPhotoStage(null);
    }
  };
  const unstraighten = () => {
    const st = design.photo?.straightened;
    if (!st) return;
    patch({ photo: { ...st.before, straightened: null } });
    setPhotoHref(null);
    setPhotoNote(null);
  };
  const suggestedHeight = design.photo?.fit?.suggestedHeightIn ?? null;
  const heightOffer = suggestedHeight !== null && Math.abs(suggestedHeight - design.heightIn) >= 2 ? suggestedHeight : null;
  const refreshPhoto = async () => {
    if (!design.photo) return;
    const href = await deckPhotoHref(design.photo.url).catch(() => null);
    if (href) setPhotoHref(href);
  };
  const removePhoto = () => {
    patch({ photo: null });
    setPhotoHref(null);
    if (view === "photo") setView("3d");
  };
  React.useEffect(() => {
    if (opened?.design.photo) {
      deckPhotoHref(opened.design.photo.url)
        .then((href) => {
          if (href) setPhotoHref(href);
        })
        .catch(() => {});
    }
  }, [opened]);

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
    setActAt("bottom");
    setBusy("convert");
    setError(null);
    setConfirmAt(null);
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
  const update = async () => {
    if (!linked) return;
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
    <div className="v5-call v5-call--warn v5-confirm" role="alertdialog" aria-label="Update a proposal the client has" data-deck-update-confirm>
      <p>
        <b>The client already has this proposal{linked.status === "VIEWED" ? " and has opened it" : ""}.</b> Updating it changes the price and the 3D on their link.
      </p>
      <div className="v5-acts">
        <button type="button" className="v5-btn v5-btn--sm v5-btn--primary" onClick={() => void update()} data-deck-update-yes>
          Update it
        </button>
        <button type="button" className="v5-btn v5-btn--sm" onClick={() => setConfirmAt(null)}>
          Cancel
        </button>
      </div>
    </div>
  ) : null;
  // THE MATERIAL LIST (owner, 2026-10-11): the takeoff for the lumber yard's quote or the installer's purchase, on its own page.
  const materialsHref = React.useCallback((forWhom: "yard" | "installer") => {
    try {
      const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ design, address, title: draftTitle.trim() || undefined }))));
      return `/deck-materials?d=${encodeURIComponent(payload)}&for=${forWhom}`;
    } catch {
      return null;
    }
  }, [design, address, draftTitle]);
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
  const structureSummary = `${what}${withRoof && design.structure !== "covered-deck" ? ` · ${FLOOR_LABEL[design.floor].toLowerCase()}` : ""}`;
  const siteSummary = withDeck
    ? `${design.placement === "attached" ? "On a ledger" : design.placement === "beside" ? "Own posts by the house" : "Free-standing"} · frost ${design.frostIn} in. · ${design.loadPsf} psf${structure.gradePct >= 2 ? ` · ${structure.gradePct}% fall` : ""}`
    : `${design.loadPsf} psf · ${design.soilPsf.toLocaleString("en-US")} psf soil · frost ${design.frostIn} in.`;
  const frameSummary = frame ? `${frame.joistSize} @ ${frame.spacingIn}" · ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")} ${frame.beamStyle === "flush" ? "flush" : "beam"} · ${frame.species.short}` : "";
  const trimSummary = frame ? [PATTERN_LABEL[design.decking.pattern], design.decking.border ? `${design.decking.border}-board border` : "", pkg.takeoff.surface?.fastening === "hidden" ? "hidden clips" : "screws", pkg.takeoff.surface?.fascia.on ? "fascia" : "no fascia", `${design.decking.wastePct}% waste`].filter(Boolean).join(" · ") : "";
  const roofSummary = roof ? roofWords(roof) : "";
  const electricSummary = structure.electrical.on ? electricalWords(structure.electrical) : "None";
  const photoSummary = design.photo ? (design.photo.fit && !design.photo.fit.notes[0]?.startsWith("The wall could not") ? "Fitted to the wall" : design.photo.placed ? "Placed on the photo" : "Photo added — place it") : "No photo yet";
  const shapeMoreSummary = [design.shape.kind === "L" ? `L-shaped, ${CORNER_LABEL[design.shape.notch.corner].toLowerCase()} cut` : design.shape.kind === "rect" && design.shape.front ? FRONT_LABEL[design.shape.front.kind] : "Rectangle", design.lower.on ? `lower level ${design.lower.widthFt} × ${design.lower.depthFt} ft` : "", design.spa.on ? "hot-tub spot" : ""].filter(Boolean).join(" · ");
  const railMoreSummary = design.rail.type === "none" ? "No railing" : `${RAIL_INFILL_LABEL[structure.rails.infill]} · posts ${design.rail.postSpacingFt} ft apart${design.rail.cap ? " · drink cap" : ""}`;
  const extrasMoreSummary = [design.extras.demoSqFt ? `${design.extras.demoSqFt} sq ft tear-out` : "No tear-out", design.extras.stainless ? "stainless" : ""].filter(Boolean).join(" · ");

  const bomByStep = React.useMemo(() => {
    const out = new Map<BomStep, typeof pkg.bom>();
    for (const l of pkg.bom) out.set(l.step, [...(out.get(l.step) ?? []), l]);
    return out;
  }, [pkg]);

  // ── PRODUCTS OF THE SHOP'S OWN (2026-10-12): every material list ends with Custom.
  const setCustom = (slot: CustomSlot, p: CustomProduct | undefined) => patch({ custom: { [slot]: p } as DeckDesign["custom"] });
  const dropCustom = (slot: CustomSlot) => {
    if (design.custom[slot]) setCustom(slot, undefined);
  };
  /** What the list's choice costs now, in the slot's unit: where the shop's own product starts. */
  const slotPrice = (slot: CustomSlot): number => {
    const ids: Record<CustomSlot, (id: string, step: BomStep) => boolean> = {
      decking: (id, step) => (step === "decking" && id.startsWith("boards-")) || (step === "stairs" && id.startsWith("tread-boards-") && !id.startsWith("tread-boards-own-")),
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
  // and the generic composite, PVC, mineral-based and aluminum boards. Custom closes it.
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

  const issues = checks.filter((c) => c.level === "fail" || c.level === "warn");
  const ordered = [...checks].sort((a, b) => ["fail", "warn", "info", "pass"].indexOf(a.level) - ["fail", "warn", "info", "pass"].indexOf(b.level));
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
    <li key={c.id} className={cx("v5-check", `v5-check--${c.level}`)} data-check={c.id}>
      <span className="v5-check-level">{LEVEL_LABEL[c.level]}</span>
      <div className="v5-check-body">
        <div className="v5-check-text">
          <b>{c.part}.</b> {c.text}
        </div>
        {c.rule ? <div className="v5-check-rule">{c.rule}</div> : null}
        {c.fix || c.alts?.length ? (
          <div className="v5-acts">
            {c.fix ? (
              <button type="button" className="v5-btn v5-btn--sm" onClick={() => patch(c.fix!.patch)} data-check-fix="primary">
                {c.fix.label}
              </button>
            ) : null}
            {(c.alts ?? []).map((a) => (
              <button key={a.label} type="button" className="v5-btn v5-btn--sm v5-btn--quiet" onClick={() => patch(a.patch)} data-check-fix="alt">
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
  const [checksOpen, setChecksOpen] = React.useState(false);
  /** Opens a named More (or a section below the editor) and brings it into view. */
  const openMore = (id: string) => {
    const el = document.getElementById(id);
    if (el instanceof HTMLDetailsElement) el.open = true;
    const calm = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  };

  const kinds = KINDS_FOR[design.structure];
  const planShapes: RoofPlanShape[] = design.structure === "pergola" ? (withDeck ? ["follows-deck", "square", "rect"] : ["square", "rect"]) : design.structure === "covered-deck" ? ["follows-deck", "square", "rect"] : withDeck ? ["follows-deck", "square", "rect", "hexagon", "octagon", "round"] : ["square", "rect", "hexagon", "octagon", "round"];
  const canAttach = (withDeck ? design.placement !== "detached" : true) && !polygon && r.kind !== "pyramid" && r.kind !== "double-tier" && r.kind !== "gambrel" && r.kind !== "dutch-gable" && r.kind !== "pergola";
  // The roof's outline and size — in the Roof over a deck; the size itself for a gazebo or pergola on its own floor.
  const outlineBlock = (big: boolean) => (
    <>
      <Field label="Outline" wide group>
        <Seg big={big} label="Roof outline" value={r.plan.shape} onChange={(sh: RoofPlanShape) => rp({ plan: { ...r.plan, shape: sh } })} options={planShapes.map((sh) => ({ value: sh, label: ROOF_PLAN_LABEL[sh] }))} />
      </Field>
      {r.plan.shape !== "follows-deck" ? (
        <div className="v5-grid2">
          {polygon ? (
            <Field label="Across the flats" aside="ft" group={big}>
              {big ? (
                <Stepper label="Across the flats, feet" unit="ft" step={1} value={r.plan.acrossFt} parse={parseFeet} format={feetText} min={ROOF_LIMITS.acrossFt.min} max={ROOF_LIMITS.acrossFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, acrossFt: n2 } })} />
              ) : (
                <NumberInput label="Across the flats, feet" value={r.plan.acrossFt} parse={parseFeet} format={feetText} min={ROOF_LIMITS.acrossFt.min} max={ROOF_LIMITS.acrossFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, acrossFt: n2 } })} />
              )}
            </Field>
          ) : (
            <>
              <Field label={r.plan.shape === "square" ? "Across" : "Along the house"} aside="ft" group={big}>
                {big ? (
                  <Stepper label="Roof width, feet" unit="ft" step={1} value={r.plan.widthFt} parse={parseFeet} format={feetText} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, widthFt: n2, depthFt: r.plan.shape === "square" ? n2 : r.plan.depthFt } })} />
                ) : (
                  <NumberInput label="Roof width, feet" value={r.plan.widthFt} parse={parseFeet} format={feetText} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, widthFt: n2, depthFt: r.plan.shape === "square" ? n2 : r.plan.depthFt } })} />
                )}
              </Field>
              {r.plan.shape === "rect" ? (
                <Field label="Out from the house" aside="ft" group={big}>
                  {big ? (
                    <Stepper label="Roof depth, feet" unit="ft" step={1} value={r.plan.depthFt} parse={parseFeet} format={feetText} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, depthFt: n2 } })} />
                  ) : (
                    <NumberInput label="Roof depth, feet" value={r.plan.depthFt} parse={parseFeet} format={feetText} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} onCommit={(n2) => rp({ plan: { ...r.plan, depthFt: n2 } })} />
                  )}
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
        <p className="v5-hint">{Math.round(roof.footprintSqFt)} sq ft under the eaves · {roof.posts.length} posts{roof.attach === "wall" ? " and the house wall" : ""}{roof.kind !== "pergola" ? ` · ${Math.round(roof.roofAreaSqFt)} sq ft of roof, ${roof.squares} squares` : ""}{roof.engineered ? " · engineered beam where the sawn tables stop" : ""}</p>
      ) : null}
    </>
  );
  const metalRoof = r.roofing === "metal-panel" || r.roofing === "standing-seam";
  const front = design.shape.kind === "rect" ? design.shape.front : undefined;
  const woodRail = design.rail.type === "treated" || design.rail.type === "cedar";
  const infills = design.rail.type === "cable" ? (["auto", "cable"] as const) : design.rail.type === "glass" ? (["auto", "glass"] as const) : design.rail.type === "aluminum" ? (["auto", "balusters", "cable", "glass", "horizontal"] as const) : woodRail ? (["auto", "balusters", "horizontal"] as const) : (["auto", "balusters", "panel"] as const);
  const placingFixture = placing?.kind === "fixture" ? design.electrical.fixtures.find((f) => f.id === placing.id) : null;
  /** What the deck on screen is called: the sample it is, or its own words. */
  const sampleName = applied && applied.design === design ? DECK_SAMPLES.find((x) => x.id === applied.id)?.name ?? null : null;
  const deckName = draftTitle.trim() || sampleName || structureWords(design);
  const lumberLine = `${(frame ?? roof)?.species.region ?? ""} lumber: ${(frame ?? roof)?.species.short ?? ""}`;
  const saveWords = saveState === "saving" ? "Saving…" : saveState === "saved" && savedAt ? `${linked ? "Draft saved" : "Saved"} ${ago(savedAt)}` : saveState === "failed" ? "Not saved — will retry" : linked ? `Opened from ${linked.ref}` : "Saves as you go";
  const priceStamp = exampleShare > 0 ? (
    stage === "editor" ? (
      <button type="button" className="v5-stamp v5-stamp--warn v5-stamp--btn" onClick={() => openMore("deck-rates")} title="Set your own under Your prices">
        {exampleShare}% example prices
      </button>
    ) : (
      <span className="v5-stamp v5-stamp--warn">{exampleShare}% example prices</span>
    )
  ) : (
    <span className="v5-stamp v5-stamp--pass">Your prices</span>
  );

  /* ── the job address: on the gallery large, in the editor's bar compact ── */
  const addressField = (compact: boolean) => (
    <form
      className={cx("v5-addr", compact && "v5-addr--compact")}
      onSubmit={(e) => {
        e.preventDefault();
        commitAddress(addressDraft);
      }}
    >
      <label className="v5-field v5-field--wide">
        <span className="v5-lbl">
          <span>Job address</span>
        </span>
        <span className="v5-addr-row">
          <input className={cx("v5-in", !compact && "v5-in--addr")} value={addressDraft} placeholder="Street, city, state ZIP" autoComplete="street-address" onChange={(e) => setAddressDraft(e.target.value)} onBlur={() => addressDraft.trim() !== address && commitAddress(addressDraft)} />
          {!compact ? (
            <button type="submit" className="v5-btn" disabled={addressDraft.trim() === address}>
              Set address
            </button>
          ) : null}
        </span>
      </label>
      <p className="v5-addr-facts">
        <span>{site.label}</span>
        <span>frost {design.frostIn} in.</span>
        <span>snow {design.site.groundSnowPsf} psf</span>
        <span>{lumberLine}</span>
        {pkg.storeShare > 0 && !compact ? <span title={`Materials at ${STORE_SURVEY.store}'s listed prices, surveyed once (${STORE_SURVEY.asOf}) — your own prices win`} data-deck-store-share>materials at {STORE_SURVEY.store}, {new Date(STORE_SURVEY.asOf + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span> : null}
      </p>
    </form>
  );

  /* ── the drafts: in the head, on both views ── */
  const draftsMenu = (
    <details className="v5-pop" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void refreshDrafts()} data-deck-drafts>
      <summary className="v5-btn v5-btn--sm">
        Drafts
        <Chevron />
      </summary>
      <div className="v5-pop-panel" role="group" aria-label="Drafts">
        <div className="v5-pop-title">Saved drafts</div>
        <div className="v5-draft-name">
          <Field label="This draft's name">
            <input className="v5-in" value={draftTitle} placeholder={structureWords(design)} onChange={(e) => { dirty.current = true; setDraftTitle(e.target.value); }} />
          </Field>
          <button type="button" className="v5-btn v5-btn--sm" onClick={startFresh}>New deck</button>
        </div>
        {drafts === null ? <div className="v5-empty">Reading…</div> : drafts.length === 0 ? <div className="v5-empty">No saved drafts yet. The one you work on appears here a moment after your first change.</div> : null}
        <div className="v5-pop-list">
          {(drafts ?? []).map((d) => (
            <div key={d.id} className="v5-list-row" data-deck-draft={d.id}>
              <div className="v5-list-text">
                <div className="v5-list-name">{d.title}{d.id === draftId ? " · open" : ""}</div>
                <div className="v5-list-meta">{ago(d.updatedAt)}{d.fromClient ? ` · from ${d.fromClient}` : ""}{d.proposalId ? " · changes to a saved proposal" : ""}{d.address ? ` · ${d.address}` : ""}{d.by && !d.fromClient ? ` · ${d.by}` : ""}</div>
              </div>
              <button type="button" className="v5-btn v5-btn--sm" onClick={() => void openDraft(d.id)} disabled={d.id === draftId}>Open</button>
              <button type="button" className="v5-btn v5-btn--sm v5-btn--icon" onClick={() => void removeDraft(d.id)} aria-label={`Delete the draft ${d.title}`} title="Delete the draft"><XIcon /></button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );

  /* ── the banners: a client's return, the client's words, the proposal it is on ── */
  const banners = (
    <>
      {inboxNew.length ? (
        <section className="v5-banner v5-banner--new" aria-live="polite" aria-label="Designs sent back by clients" data-deck-inbox={inboxNew.length}>
          {inboxNew.slice(0, 3).map((l) => (
            <div key={l.token} className="v5-banner-row" data-deck-inbox-row={l.token}>
              <div className="v5-banner-text">
                <b>{l.clientName}</b> sent back a deck design{l.sentAt ? <span className="v5-quiet"> · {ago(l.sentAt)}</span> : null}
                <span className="v5-banner-sub">for {jobLine(l)}{l.words && (l.proposal || l.words !== l.title) ? ` · ${l.words}` : ""}</span>
                {l.note ? <span className="v5-banner-note">“{l.note.length > 120 ? `${l.note.slice(0, 120)}…` : l.note}”</span> : null}
              </div>
              <div className="v5-acts">
                {l.draftId ? (
                  <a className="v5-btn v5-btn--sm v5-btn--primary" href={`${HERE}?draft=${l.draftId}`} onClick={go(`${HERE}?draft=${l.draftId}`)} data-deck-inbox-open>
                    Open it
                  </a>
                ) : null}
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => putAside(l)} aria-label={`Put ${l.clientName}'s design aside until they send again`} title="Put it aside — it comes back when they send again">
                  Later
                </button>
              </div>
            </div>
          ))}
          {inboxNew.length > 3 ? <div className="v5-quiet">and {inboxNew.length - 3} more under Send to client</div> : null}
        </section>
      ) : null}
      {fromClient ? (
        <section className="v5-banner" aria-label="What the client sent" data-deck-from-client>
          <div className="v5-banner-text">
            <b>{fromClient.name}&apos;s design</b>
            <span className="v5-quiet">{fromClient.sends > 1 ? ` · sent ${fromClient.sends} times` : ""}{fromClient.sentAt ? ` · ${ago(fromClient.sentAt)}` : ""}</span>
            {!linked ? <span className="v5-banner-sub">{fromClient.title}{fromClient.address ? ` · ${fromClient.address}` : ""}</span> : null}
            <span className="v5-banner-note">
              {fromClient.note ? <>“{fromClient.note}” </> : <>No note with it. </>}
              {fromClient.unsure.includes("height") ? <b>Not sure of the height — measure it on site. </b> : null}
              {linked ? "Price it, then update the proposal." : "Price it, then make the proposal — the client's link follows it."}
            </span>
          </div>
          <div className="v5-acts">
            {fromClient.phone ? <a className="v5-btn v5-btn--sm" href={`tel:${fromClient.phone}`}>Call {fromClient.name.split(/\s+/)[0]}</a> : null}
            <a className="v5-btn v5-btn--sm" href={fromClient.url} target="_blank" rel="noopener">Their page ↗</a>
          </div>
        </section>
      ) : null}
      {linked ? (
        <section className="v5-banner" aria-label="The proposal this design is on" data-deck-linked={linked.lock ? "locked" : behind ? "behind" : "even"}>
          <div className="v5-banner-text">
            <span className="v5-banner-title">
              <b>{linked.ref}</b> {linked.title}
              <span className={cx("v5-stamp", linked.lock ? "v5-stamp--warn" : linked.seen ? "v5-stamp--info" : "v5-stamp--pass")} data-deck-linked-status>{PROPOSAL_STATUS_WORDS[linked.status] ?? linked.status}</span>
            </span>
            <span className="v5-banner-note">
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
          <div className="v5-acts">
            <a className="v5-btn v5-btn--sm" href={`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}`} onClick={go(`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}`)} data-deck-linked-back>
              Back to the proposal
            </a>
            {!linked.lock && behind ? (
              <button type="button" className="v5-btn v5-btn--sm v5-btn--primary" disabled={!!busy} onClick={() => askUpdate("top")} data-deck-update="top">
                {busy === "update" ? "Updating…" : "Update the proposal"}
              </button>
            ) : null}
          </div>
          {confirmAt === "top" ? confirmBox : null}
          {error && actAt === "top" ? (
            <p className="v5-call v5-call--bad" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );

  /* ══ THE EDITOR: the 3D on the left ══ */
  const stagePane = (
    <section ref={viewerRef} className="v5-stage" aria-label={`The ${what.toLowerCase()}`} data-deck-viewer>
      <div className="v5-stage-top">
        <Seg label="View" value={view} onChange={setView} options={PHOTO_ENABLED ? [{ value: "3d" as const, label: "3D" }, { value: "plan" as const, label: "Framing plan" }, { value: "wall" as const, label: "House & deck" }, { value: "photo" as const, label: "Photo" }] : [{ value: "3d" as const, label: "3D" }, { value: "plan" as const, label: "Framing plan" }, { value: "wall" as const, label: "House & deck" }]} />
        <span className="v5-mono v5-stage-facts">{scene.facts}</span>
      </div>
      <div className={cx("v5-view", view === "wall" && "v5-view--wall")}>
        {view === "wall" ? (
          <div className="v5-plan-wrap v5-plan-wrap--wall" onPointerDownCapture={quiet} data-deck-wall-large-view>
            <HouseWallPlan size="large" shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} />
          </div>
        ) : view === "3d" ? (
          <>
            <DeckModel3D scene={scene} built={built} xray={xray} backdrop={backdrop} night={night} connections={connections} placing={placing?.kind === "fixture" || placing?.kind === "stair"} edit={editing} onEdit={onEdit} resetToken={resetToken} focus={focus} onPick={onPick} highlight={wallLit ?? fieldLit} className="v5-canvas" label={`The ${what.toLowerCase()} in 3D: ${scene.facts}`} />
            {editing && !placing ? (
              <div className="v5-banner-float" data-deck-editing>
                <span>Drag the blue knobs: width, depth and height, the roof&apos;s height and pitch, the lower level, each stair, the house&apos;s corners and every step in its wall. It re-frames and re-prices as you drag.</span>
                <button type="button" className="v5-btn v5-btn--sm v5-btn--primary" onClick={() => setEditing(false)}>Done</button>
              </div>
            ) : null}
            {hoverPick?.legend && !placing ? (
              <div className="v5-pick-tag" data-deck-hover>
                <b>{hoverPick.legend.role}{hoverPick.legend.nominal ? ` · ${hoverPick.legend.nominal}` : ""}{hoverPick.legend.lengthFt ? ` · ${ftIn(hoverPick.legend.lengthFt * 12)}` : ""}</b>
                {hoverPick.legend.note.split(/(?<=\.)\s/)[0]} {hoverPick.layer !== null ? <span className="v5-mono">click to zoom</span> : null}
              </div>
            ) : null}
            {placing?.kind === "stair" ? (
              <div className="v5-banner-float" data-deck-placing="stair-3d">
                <span>Click the deck where the stairs go — they take the nearest open edge, on whichever level you click.</span>
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => setPlacing(null)}>Cancel</button>
              </div>
            ) : null}
            {placingFixture ? (
              <div className="v5-banner-float" data-deck-placing="fixture">
                <span>Click on the {what.toLowerCase()} where the {FIXTURE_SHORT[placingFixture.kind].toLowerCase()} goes — a post, a header, the rail, the ceiling, the house wall.</span>
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => setPlacing(null)}>Cancel</button>
              </div>
            ) : null}
          </>
        ) : view === "plan" ? (
          <div className="v5-plan-wrap">
            <DeckPlan structure={structure} placing={placing?.kind === "stair" ? "stair" : null} onPlaceStair={placeStair} />
            {placing?.kind === "stair" ? (
              <div className="v5-banner-float" data-deck-placing="stair">
                <span>Click an open edge of the deck where the stairs go.</span>
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => setPlacing(null)}>Cancel</button>
              </div>
            ) : null}
          </div>
        ) : design.photo ? (
          <DeckPhotoView photo={design.photo} href={photoHref} elevation={elevation} onPlace={(placed) => patch({ photo: { ...design.photo!, placed } })} onRefresh={refreshPhoto} marking={marking} read={marking ? markRead : (design.photo.fit?.read ?? null)} onRead={applyRead} corners={straightening ? corners : null} onCorners={setCorners} />
        ) : (
          <div className="v5-photo-empty" data-deck-photo="empty">
            <p>Take a picture of the back of the house from the yard, square on. The {what.toLowerCase()} is drawn over it.</p>
            <button type="button" className="v5-btn v5-btn--primary" onClick={pickPhoto} disabled={photoBusy}>
              {photoBusy ? (photoStage ?? "Saving the picture…") : "Add a photo of the house"}
            </button>
            {photoError ? <p className="v5-call v5-call--bad" role="alert">{photoError}</p> : null}
          </div>
        )}
      </div>
      {view === "3d" ? (
        <>
          <div className="v5-tools">
            <button type="button" className={cx("v5-btn v5-btn--sm", playing && "is-on")} onClick={() => (playing ? setPlaying(false) : play())}>
              {playing ? "Pause" : "Build it"}
            </button>
            <label className="v5-build">
              <span className="v5-mono">{layerNow}</span>
              <input type="range" min={0} max={LAYERS} step={0.01} value={sliderValue} aria-label="How much is standing" onChange={(e) => { setPlaying(false); setBuilt(Number(e.target.value)); }} />
            </label>
            <button
              type="button"
              className={cx("v5-btn v5-btn--sm", editing ? "is-on" : "v5-btn--breath")}
              aria-pressed={editing}
              title="Drag the deck, the stairs and the house's walls right in the 3D"
              onClick={() => setEditing((x) => !x)}
              data-deck-edit
              data-deck-edit-breathing={!editing ? "" : undefined}
            >
              Edit in 3D
            </button>
            {structure.frame ? (
              <button type="button" className={cx("v5-btn v5-btn--sm", placing?.kind === "stair" && "is-on")} aria-pressed={placing?.kind === "stair"} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => setPlacing(placing?.kind === "stair" ? null : { kind: "stair" })} data-deck-3d-add-stair>
                {placing?.kind === "stair" ? "Click the deck…" : "+ Stairs"}
              </button>
            ) : null}
            <button type="button" className={cx("v5-btn v5-btn--sm", xray && "is-on")} aria-pressed={xray} onClick={() => setXray((x) => !x)}>
              X-ray
            </button>
            {PHOTO_ENABLED && design.photo?.placed ? (
              <button type="button" className={cx("v5-btn v5-btn--sm", showHouse && "is-on")} aria-pressed={showHouse} onClick={() => setShowHouse((v) => !v)} data-deck-house-toggle>
                House photo
              </button>
            ) : null}
            <button type="button" className={cx("v5-btn v5-btn--sm", connections && "is-on")} aria-pressed={connections} onClick={() => setConnections((c) => !c)} data-deck-connections>
              Connections
            </button>
            <button type="button" className={cx("v5-btn v5-btn--sm", night && "is-on")} aria-pressed={night} onClick={() => setNight((x) => !x)} data-deck-night>
              Night
            </button>
            <button type="button" className="v5-btn v5-btn--sm" onClick={() => { setResetToken((t) => t + 1); setPicked(null); }}>
              Reset view
            </button>
          </div>
          {picked ? (
            <div className="v5-pick" data-deck-picked>
              <div className="v5-pick-head">
                {picked.legend.role}
                <span>{picked.legend.nominal}{picked.legend.lengthFt ? ` · ${ftIn(picked.legend.lengthFt * 12)}` : ""}{picked.legend.count > 1 ? ` · ${picked.legend.count} of them` : ""}</span>
              </div>
              <p className="v5-pick-body">{picked.legend.note}</p>
              <div className="v5-acts">
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => setFocus([...picked.point] as [number, number, number])}>Zoom</button>
                <button type="button" className="v5-btn v5-btn--sm v5-btn--quiet" onClick={() => setPicked(null)}>Close</button>
              </div>
            </div>
          ) : connections ? (
            <div className="v5-pick">
              <p className="v5-pick-body">Numbered tags mark the connections: click one to read how it is made and fly to it. Click any part — a joist, a hanger, a rafter, a bolt — to name it.</p>
            </div>
          ) : null}
        </>
      ) : PHOTO_ENABLED && view === "photo" && design.photo ? (
        <>
          <div className="v5-tools">
            <span className="v5-mono">{design.photo.fit ? "Fitted to the wall — drag to adjust, pull the handle to size" : "Drag the outline to the wall · pull the handle to size it"}</span>
            <button type="button" className="v5-btn v5-btn--sm v5-btn--primary" onClick={refitPhoto} disabled={photoBusy} data-deck-photo-refit>{photoBusy ? (photoStage ?? "Working…") : "Fit to the wall"}</button>
            <button type="button" className={cx("v5-btn v5-btn--sm", marking && "is-on")} aria-pressed={marking} onClick={() => { setStraightening(false); setCorners(null); setMarking((m) => !m); }} data-deck-photo-mark>{marking ? "Marking the wall" : "Mark the wall"}</button>
            <button type="button" className={cx("v5-btn v5-btn--sm", straightening && "is-on")} aria-pressed={straightening} onClick={() => (straightening ? cancelStraighten() : startStraighten())} disabled={photoBusy} data-deck-photo-straighten>{straightening ? "Straightening" : "Straighten the picture"}</button>
            {design.photo.straightened ? <button type="button" className="v5-btn v5-btn--sm" onClick={unstraighten} disabled={photoBusy} data-deck-photo-unstraighten>Original picture</button> : null}
            {design.photo.fit?.read ? <button type="button" className="v5-btn v5-btn--sm" onClick={() => void readPhotoAgain()} disabled={photoBusy} data-deck-photo-reread>Read the picture again</button> : null}
            {design.photo.fit?.offer ? (
              <button type="button" className="v5-btn v5-btn--sm" onClick={applyOffer} data-deck-photo-offer>
                {design.photo.fit.offer.kind === "notch" ? "Notch the deck around the step" : `Fit the deck into the ${design.photo.fit.offer.widthFt} ft recess`}
              </button>
            ) : null}
            {heightOffer !== null ? <button type="button" className="v5-btn v5-btn--sm" onClick={() => patch({ heightIn: heightOffer })} data-deck-photo-height>Use {heightOffer} in. height</button> : null}
            <button type="button" className="v5-btn v5-btn--sm" onClick={() => patch({ photo: { ...design.photo!, placed: defaultPlacement() } })}>Centre it</button>
            <button type="button" className="v5-btn v5-btn--sm" onClick={pickPhoto} disabled={photoBusy}>Another photo</button>
            <button type="button" className="v5-btn v5-btn--sm" onClick={removePhoto}>Remove</button>
          </div>
          {straightening ? (
            <div className="v5-tools" data-deck-photo-straighten-tools>
              <span className="v5-mono">Drag the four white corners onto the wall. The picture is then warped so the wall stands square.</span>
              <label className="v5-inline">
                <span className="v5-mono">The wall between the corners is</span>
                <NumberInput label="Width of the wall between the corners, feet" value={wallWidthFt ?? 0} parse={parseFeet} format={(n2) => (n2 > 0 ? feetText(n2) : "")} min={0} max={200} onCommit={(n2) => setWallWidthFt(n2 > 0 ? n2 : null)} />
                <span className="v5-mono">ft wide — optional</span>
              </label>
              <button type="button" className="v5-btn v5-btn--sm v5-btn--primary" onClick={() => void straightenNow()} disabled={photoBusy} data-deck-photo-straighten-go>{photoBusy ? (photoStage ?? "Working…") : "Straighten it"}</button>
              <button type="button" className="v5-btn v5-btn--sm" onClick={cancelStraighten} disabled={photoBusy}>Cancel</button>
            </div>
          ) : null}
          {marking ? (
            <div className="v5-tools" data-deck-photo-tools>
              <span className="v5-mono">Drag the ends to where the wall meets the ground · the door to its threshold and frame · a step where the wall jogs · a measure along anything you know</span>
              {markRead.door ? (
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => applyRead(removeDoor(markRead))} data-deck-mark-door="remove">Remove the door</button>
              ) : (
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => applyRead(addDoor(markRead, design.photo!.w, design.photo!.h))} data-deck-mark-door="add">Add the door</button>
              )}
              {markRead.scaleLine ? (
                <>
                  <label className="v5-inline">
                    <span className="v5-mono">The measure is</span>
                    <NumberInput label="Length of the measure, inches" value={markRead.scaleLine.lengthIn} parse={parseInches} format={(n2) => String(Math.round(n2))} min={6} max={600} onCommit={(n2) => applyRead(setScaleLength(markRead, n2))} />
                    <span className="v5-mono">in.</span>
                  </label>
                  <button type="button" className="v5-btn v5-btn--sm" onClick={() => applyRead(removeScaleLine(markRead))} data-deck-mark-measure="remove">Remove the measure</button>
                </>
              ) : (
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => applyRead(addScaleLine(markRead))} data-deck-mark-measure="add">Add a measure</button>
              )}
              <button type="button" className="v5-btn v5-btn--sm" onClick={() => applyRead(addJog(markRead))} disabled={markRead.jogs.length >= 4} data-deck-mark-step="add">Add a step</button>
              {markRead.jogs.map((j, i) => (
                <span key={i} className="v5-inline" data-deck-mark-jog={i}>
                  <span className="v5-mono">step {i + 1}</span>
                  <Seg label={`Step ${i + 1} goes`} value={j.dir} onChange={(dir: "toward" | "away") => applyRead(setJog(markRead, i, { dir }))} options={[{ value: "toward", label: "comes out" }, { value: "away", label: "steps back" }]} />
                  <NumberInput label={`Step ${i + 1} depth, feet`} value={j.depthFt ?? 2} parse={parseFeet} format={feetText} min={0.5} max={40} onCommit={(n2) => applyRead(setJog(markRead, i, { depthFt: n2 }))} />
                  <button type="button" className="v5-btn v5-btn--sm v5-btn--icon" onClick={() => applyRead(removeJog(markRead, i))} aria-label={`Remove step ${i + 1}`}><XIcon /></button>
                </span>
              ))}
              <button type="button" className="v5-btn v5-btn--sm v5-btn--primary" onClick={() => setMarking(false)} data-deck-mark-done>Done</button>
            </div>
          ) : null}
          {design.photo.fit?.notes.length || photoNote ? (
            <ul className="v5-notes" data-deck-photo-fit aria-label="What the picture showed">
              {photoNote ? <li className="is-bad">{photoNote}</li> : null}
              {(design.photo.fit?.notes ?? []).map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          ) : null}
        </>
      ) : null}
      <input ref={fileRef} className="v5-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Photo of the house" onChange={(e) => void onPhotoFile(e.target.files?.[0] ?? null)} />
      {autoNotes.length ? (
        <p className="v5-auto" role="status" data-deck-autofix>
          Re-sized to the tables: {autoNotes.join(" · ")}.
        </p>
      ) : null}
    </section>
  );

  /* ══ THE EDITOR: the price, the checks line, the usual controls, the Mores, the finish ══ */
  const checkLine = (
    <button type="button" className={cx("v5-checkline", summary.fail ? "is-bad" : summary.warn ? "is-warn" : "is-pass")} aria-expanded={checksOpen} aria-controls="deck-checks" onClick={() => setChecksOpen((v) => !v)} data-v5-checkline>
      <span className="v5-checkline-stamps">
        {summary.fail ? <span className="v5-stamp v5-stamp--bad">{summary.fail} to fix</span> : null}
        {summary.warn ? <span className="v5-stamp v5-stamp--warn">{summary.warn} to check</span> : null}
        {!summary.fail && !summary.warn ? <span className="v5-stamp v5-stamp--pass">Code checks pass</span> : null}
      </span>
      <span className="v5-checkline-text">{issues[0] ? `${issues[0].part}: ${issues[0].text.split(/(?<=\.)\s/)[0]}` : `${summary.pass} checks against the code tables`}</span>
      <Chevron />
    </button>
  );
  const checksPanel = checksOpen ? (
    <section className="v5-checks" id="deck-checks" aria-label="Code checks">
      <div className="v5-checks-head">
        <p className="v5-hint">Each part against the table it is sized from. Estimating grade — the building department decides.</p>
        {fixableCount ? (
          <button type="button" className="v5-btn v5-btn--sm" onClick={runAutoFix} data-deck-autofix>
            Auto-fix {fixableCount === 1 ? "1 item" : `${fixableCount} items`}
          </button>
        ) : null}
      </div>
      {fixReport ? (
        <div className={cx("v5-call", fixReport.left.length ? "v5-call--warn" : "v5-call--pass")} role="status" data-deck-fix-report>
          <button type="button" className="v5-btn v5-btn--sm v5-btn--icon v5-call-close" onClick={() => setFixReport(null)} aria-label="Close"><XIcon /></button>
          {fixReport.fixed.length ? <p><b>Fixed:</b> {fixReport.fixed.join(" · ")}.</p> : <p><b>Nothing the studio can change on its own.</b></p>}
          {fixReport.left.length ? (
            <>
              <p><b>Still for you, an engineer or the building office:</b></p>
              <ul>{fixReport.left.slice(0, 8).map((l, i) => <li key={i}>{l}</li>)}</ul>
            </>
          ) : (
            <p>Every check passes or is a note.</p>
          )}
        </div>
      ) : null}
      <ul className="v5-check-list">{ordered.filter(loud).map((c) => checkRow(c))}</ul>
      {ordered.some((c) => !loud(c)) ? (
        <details className="v5-check-more" data-deck-checks-more>
          <summary>
            {(() => {
              const notes = ordered.filter((c) => !loud(c) && c.level === "info").length;
              const passes = ordered.filter((c) => c.level === "pass").length;
              return [notes ? `${notes} ${notes === 1 ? "note" : "notes"}` : "", passes ? `${passes} passed` : ""].filter(Boolean).join(" and ");
            })()}
            <Chevron />
          </summary>
          <ul className="v5-check-list">{ordered.filter((c) => !loud(c)).map((c) => checkRow(c))}</ul>
        </details>
      ) : null}
    </section>
  ) : null;

  const usual = (
    <div className="v5-usual">
      {/* SIZE — a deck's width and depth; a gazebo or pergola on its own floor is sized by its roof's outline. */}
      {withDeck ? (
        <Scope step="step-shape">
          <section className="v5-sec" aria-label="Size">
            <div className="v5-sec-head">
              <h3 className="v5-sec-title">Size</h3>
              <span className="v5-sec-val">{sizeWords(design)} · {Math.round(pkg.areaSqFt)} sq ft</span>
            </div>
            <div className="v5-grid2">
              <Field label="Along the house" aside="ft" group>
                <Stepper label="Width along the house, feet" unit="ft" step={1} value={design.shape.widthFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.widthFt.min} max={DECK_LIMITS.widthFt.max} onCommit={(n2) => patch({ shape: { ...design.shape, widthFt: n2 } })} />
              </Field>
              <Field label="Out from the house" aside="ft" group>
                <Stepper label="Depth out from the house, feet" unit="ft" step={1} value={design.shape.depthFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.depthFt.min} max={DECK_LIMITS.depthFt.max} onCommit={(n2) => patch({ shape: { ...design.shape, depthFt: n2 } })} />
              </Field>
            </div>
          </section>
        </Scope>
      ) : (
        <Scope step="step-footprint">
          <section className="v5-sec" aria-label="Size">
            <div className="v5-sec-head">
              <h3 className="v5-sec-title">Size</h3>
              <span className="v5-sec-val">{sizeWords(design)}</span>
            </div>
            {outlineBlock(true)}
          </section>
        </Scope>
      )}

      {/* HEIGHT — the deck's surface over the ground. */}
      {withDeck ? (
        <Scope step="step-site">
          <section className="v5-sec" aria-label="Height">
            <div className="v5-sec-head">
              <h3 className="v5-sec-title">Height</h3>
              <span className="v5-sec-val">{ftIn(design.heightIn)} off the ground</span>
            </div>
            <Field label="Deck height" aside="in. to the surface" group>
              <Stepper label="Height of the deck surface above the ground, inches" unit="in." step={2} value={design.heightIn} parse={parseInches} format={(n2) => String(Math.round(n2 * 4) / 4)} min={DECK_LIMITS.heightIn.min} max={DECK_LIMITS.heightIn.max} onCommit={(n2) => patch({ heightIn: n2 })} />
            </Field>
            <div className="v5-chips" role="group" aria-label="Usual heights">
              {HEIGHT_PRESETS.map((h) => (
                <button key={h.label} type="button" className={cx("v5-chip", design.heightIn === h.inches && "is-on")} aria-pressed={design.heightIn === h.inches} onClick={() => patch({ heightIn: h.inches })}>
                  {h.label} <span>{ftIn(h.inches)}</span>
                </button>
              ))}
            </div>
          </section>
        </Scope>
      ) : null}

      {/* ROOF SHAPE — for a kind with a roof, the one roof choice that usually changes; the rest is under More: Roof. */}
      {withRoof && roof && (kinds.length > 1 || design.structure === "pergola") ? (
        <Scope step="step-roof">
          <section className="v5-sec" aria-label={design.structure === "pergola" ? "The top" : "Roof shape"}>
            <div className="v5-sec-head">
              <h3 className="v5-sec-title">{design.structure === "pergola" ? "The top" : "Roof shape"}</h3>
              <span className="v5-sec-val">{design.structure === "pergola" ? PERGOLA_STYLE_LABEL[r.pergolaStyle] : `${r.pitch}:12 pitch`}</span>
            </div>
            {design.structure === "pergola" ? (
              <Field label="The top" wide group>
                <Seg big label="Pergola top" value={r.pergolaStyle} onChange={(v) => rp({ pergolaStyle: v })} options={(["flat", "louvered", "arched"] as const).map((v) => ({ value: v, label: PERGOLA_STYLE_LABEL[v] }))} />
              </Field>
            ) : (
              <Field label="Roof shape" wide group>
                <Seg big label="Roof shape" value={r.kind} onChange={(k: RoofKind) => rp({ kind: k })} options={kinds.map((k) => ({ value: k, label: ROOF_KIND_LABEL[k].split(" — ")[0] }))} />
              </Field>
            )}
            {roof.kindNote ? <p className="v5-hint v5-hint--warn">{roof.kindNote}</p> : null}
          </section>
        </Scope>
      ) : null}

      {/* BOARDS — what it is walked on: the board list, or one of three packages priced on this deck. */}
      {withDeck && frame && pkg.takeoff.surface ? (
        <Scope step="Surface">
          <section className="v5-sec" aria-label="Boards">
            <div className="v5-sec-head">
              <h3 className="v5-sec-title">Boards</h3>
              <span className="v5-sec-val">{design.custom.decking ? design.custom.decking.name : frame.decking.label}</span>
            </div>
            {tiers ? (
              <div className="v5-tiers" role="group" aria-label="Good, Better, Best" data-deck-tiers>
                {tiers.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={cx("v5-tier", t.current && "is-on")}
                    aria-pressed={t.current}
                    onClick={() => (t.current ? undefined : patch({ decking: { product: t.product }, rail: { type: design.rail.type === "none" && !structure.rails.required ? "none" : t.rail }, custom: { decking: undefined } }, ["decking"]))}
                    data-deck-tier={t.id}
                  >
                    <span className="v5-tier-name">{t.name}</span>
                    <span className="v5-tier-v">{money(t.subtotal)}</span>
                    <span className="v5-tier-h">{t.words}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <Field label="Deck boards" wide>
              <select className="v5-sel v5-sel--big" value={design.custom.decking ? CUSTOM : design.decking.product} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("decking") : patch({ decking: { product: e.target.value }, custom: { decking: undefined } }, ["decking"]))} data-deck-pick="decking">
                {deckingOptions}
                <option value={CUSTOM}>{CUSTOM_LABEL}</option>
              </select>
            </Field>
            {design.custom.decking ? (
              <CustomBox slot="decking" title="Deck boards" product={design.custom.decking} unit="ft of board" fresh={freshCustom === "decking"} onDone={freshDone} onChange={(p) => setCustom("decking", p)} onBack={() => setCustom("decking", undefined)} note="Priced at your number per foot of board, the stair treads too. The joist spacing, the gaps and the clips follow the board it is laid like.">
                <Field label="Laid like" wide>
                  <select className="v5-sel" value={design.decking.product} onChange={(e) => patch({ decking: { product: e.target.value } }, ["decking"])} data-deck-like="decking">
                    {deckingOptions}
                  </select>
                </Field>
              </CustomBox>
            ) : null}
          </section>
        </Scope>
      ) : null}

      {/* RAILS — the guard: what it is and how high. */}
      {withDeck ? (
        <Scope step="step-stairs">
          <section className="v5-sec" aria-label="Rails">
            <div className="v5-sec-head">
              <h3 className="v5-sec-title">Rails</h3>
              <span className="v5-sec-val">{structure.rails.on ? `${Math.round(pkg.takeoff.railLf)} ft` : "None"}</span>
            </div>
            <div className="v5-grid-rail">
              <Field label="Railing" aside={structure.rails.required && design.rail.type === "none" ? <span className="v5-req">a guard is required</span> : undefined}>
                <select className="v5-sel v5-sel--big" value={design.rail.type} onChange={(e) => patch({ rail: { type: e.target.value as DeckDesign["rail"]["type"], infill: "auto" } })} data-deck-rail>
                  {RAIL_TYPES.map((rt) => (
                    <option key={rt.id} value={rt.id}>{rt.id === "none" ? "No railing" : rt.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Height" group>
                <Seg big label="Rail height" value={design.rail.heightIn} onChange={(v) => { touched.current.add("railHeight"); patch({ rail: { heightIn: v } }); }} options={[{ value: 36, label: "36 in." }, { value: 42, label: "42 in." }]} />
              </Field>
            </div>
            {design.rail.type === "custom" ? (
              <div className="v5-grid2">
                <Field label="Your railing">
                  <NameInput label="Your railing's name" value={design.rail.customName} placeholder="Brand, line, colour" allowEmpty onCommit={(name) => patch({ rail: { customName: name } })} />
                </Field>
                <Field label="Your rail price, installed" aside="$/ft">
                  <NumberInput label="Custom rail price per foot, installed" value={design.rail.customPerFt} parse={intText} format={String} min={0} max={1000} onCommit={(n2) => patch({ rail: { customPerFt: n2 } })} />
                </Field>
              </div>
            ) : null}
          </section>
        </Scope>
      ) : null}

      {/* STAIRS — each stair as a row: its side and width here, the rest under its own More. */}
      {withDeck ? (
        <Scope step="step-stairs">
          <section className="v5-sec" aria-label="Stairs" data-deck-stairs>
            <div className="v5-sec-head">
              <h3 className="v5-sec-title">Stairs</h3>
              <span className="v5-sec-val">{design.stairs.length ? `${design.stairs.length} · ${pkg.takeoff.stairRisers} risers` : "None"}</span>
            </div>
            <div className="v5-rows">
              {design.stairs.map((st, i) => {
                const builtSt = structure.stairs.find((b) => b.design.id === st.id);
                const sideLen = st.level === "lower" ? (st.side === "front" ? design.lower.widthFt : design.lower.depthFt) : st.side === "front" ? design.shape.widthFt : design.shape.depthFt;
                const setSt = (p: Partial<StairDesign>) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, ...p } : x)));
                return (
                  <Scope key={st.id} stair={st.id}>
                    <div className="v5-row" data-deck-stair={st.id}>
                      <div className="v5-row-head">
                        <span className="v5-row-title">{st.wrap ? "Box steps" : `Stair ${i + 1}`}<span className="v5-row-sub">{builtSt ? `${builtSt.risers} risers of ${builtSt.riserIn.toFixed(2)} in.${builtSt.lands === "lower-deck" ? " to the lower level" : ""}` : ""}</span></span>
                        <button type="button" className="v5-btn v5-btn--sm v5-btn--danger" onClick={() => setStairs((list) => list.filter((x) => x.id !== st.id))}>Remove</button>
                      </div>
                      <div className="v5-grid-stair">
                        <Field label="Down the" group>
                          <Seg label="Which side" value={st.side} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, side: v, wrap: v === "front" && x.wrap } : x)))} options={(["front", "left", "right"] as const).map((v) => ({ value: v, label: STAIR_SIDE_LABEL[v] }))} />
                        </Field>
                        <Field label="Width" aside="ft">
                          <NumberInput label="Stair width, feet" value={st.widthFt} parse={parseFeet} format={feetText} min={STAIR_LIMITS.widthFt.min} max={STAIR_LIMITS.widthFt.max} onCommit={(n2) => setSt({ widthFt: n2 })} />
                        </Field>
                      </div>
                      <details className="v5-sub-more">
                        <summary>
                          More for this stair
                          <span className="v5-sub-sum">{STAIR_LANDING_LABEL[st.landing]} · handrail {st.handrail === "auto" ? "as the code asks" : st.handrail}</span>
                          <Chevron />
                        </summary>
                        <div className="v5-grid2">
                          <Field label="Centred at" aside={`ft from the ${st.side === "front" ? "left end" : "house"}`}>
                            <NumberInput label="Where the stair's middle sits along the side, feet" value={st.atFt} parse={parseFeet} format={feetText} min={st.widthFt / 2} max={Math.max(st.widthFt / 2, sideLen - st.widthFt / 2)} onCommit={(n2) => setSt({ atFt: n2 })} />
                          </Field>
                          <Field label="Lands on">
                            <select className="v5-sel" value={st.landing} onChange={(e) => setSt({ landing: e.target.value as StairDesign["landing"] })}>
                              {(["pad", "patio", "grade"] as const).map((v) => (
                                <option key={v} value={v}>{STAIR_LANDING_LABEL[v]}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Handrail">
                            <select className="v5-sel" value={st.handrail} onChange={(e) => setSt({ handrail: e.target.value as StairDesign["handrail"] })}>
                              <option value="auto">Auto — as the code asks</option>
                              <option value="both">Both sides</option>
                              <option value="one">One side</option>
                              <option value="none">None</option>
                            </select>
                          </Field>
                          {design.lower.on ? (
                            <Field label="From" group>
                              <Seg label="From which level" value={st.level} onChange={(v) => setSt({ level: v })} options={[{ value: "upper", label: "The deck" }, { value: "lower", label: "The lower level" }]} />
                            </Field>
                          ) : null}
                        </div>
                        {st.side === "front" ? (
                          <div className="v5-stack">
                            <Toggle checked={st.wrap} onChange={(v) => setSt({ wrap: v })}>Box steps wrapping the deck (three risers at most)</Toggle>
                            {st.wrap ? <Seg label="Wrap how many sides" value={st.wrapSides} onChange={(v) => setSt({ wrapSides: v })} options={[{ value: 1, label: "Front" }, { value: 3, label: "Three sides" }, ...(design.placement === "detached" ? [{ value: 4 as const, label: "All four" }] : [])]} /> : null}
                          </div>
                        ) : null}
                      </details>
                    </div>
                  </Scope>
                );
              })}
            </div>
            <div className="v5-acts">
              <button type="button" className="v5-btn" disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => setStairs((list) => [...list, defaultStair(`s${list.length + 1}-${Date.now().toString(36).slice(-3)}`, "front", design.shape.widthFt / 2)])} data-deck-add-stair>
                + Stairs down the front
              </button>
              <button type="button" className={cx("v5-btn", placing?.kind === "stair" && "is-on")} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => { setPlacing(placing?.kind === "stair" ? null : { kind: "stair" }); if (view !== "3d" && view !== "plan") setView("3d"); }} data-deck-place-stair>
                {placing?.kind === "stair" ? (view === "plan" ? "Click the plan…" : "Click the deck…") : "Place on the deck"}
              </button>
            </div>
          </section>
        </Scope>
      ) : null}
    </div>
  );

  /* ── MORE: everything rarer, each named, each saying what is set ── */
  const mores = (
    <div className="v5-mores" aria-label="More choices">
      <More title="Kind" summary={structureSummary} step="step-structure" id="v5-more-kind">
        <Field label="What it is" wide group>
          <Seg label="What it is" value={design.structure} onChange={setStructure} options={STRUCTURES.map((st) => ({ value: st, label: STRUCTURE_LABEL[st] }))} />
        </Field>
        <button type="button" className="v5-btn v5-btn--sm v5-self-start" onClick={toGallery}>Pick from the gallery</button>
        {PHOTO_ENABLED ? (
          <Field label="Where it stands" wide group>
            <div className="v5-chips" role="group" aria-label="Where it stands">
              <button type="button" className={cx("v5-chip", !design.photo && "is-on")} aria-pressed={!design.photo} onClick={() => { if (design.photo) removePhoto(); }} data-deck-site="plain">A plain site</button>
              <button type="button" className={cx("v5-chip", !!design.photo && "is-on")} aria-pressed={!!design.photo} onClick={() => (design.photo ? setView("photo") : pickPhoto())} disabled={photoBusy} data-deck-site="photo">{design.photo ? "The photo of the house" : "A photo of the house"}</button>
            </div>
          </Field>
        ) : null}
        {design.structure === "gazebo" || design.structure === "pergola" ? (
          <Field label="It stands" wide group>
            <Seg label="It stands" value={design.floor} onChange={(f: Floor) => patch({ floor: f })} options={(["deck", "slab", "ground"] as const).map((f) => ({ value: f, label: FLOOR_LABEL[f] }))} />
          </Field>
        ) : null}
        {!withDeck ? <p className="v5-hint">{design.floor === "slab" ? "A new 4-in. slab a foot wider than the posts goes in the price; the posts sit on anchored bases." : "Each post gets its own poured footing, sized for what it carries."}</p> : null}
      </More>

      {withDeck ? (
        <More title={design.structure === "gazebo" || design.structure === "pergola" ? "Shape of the deck under it" : "Shape and levels"} summary={shapeMoreSummary} step="step-shape" id="v5-more-shape">
          <Field label="Shape" wide group>
            <Seg label="Shape" value={design.shape.kind} onChange={(k) => patch({ shape: k === "rect" ? { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt } : { kind: "L", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, notch: { corner: "front-right", widthFt: Math.max(2, Math.round(design.shape.widthFt / 2)), depthFt: Math.max(2, Math.round(design.shape.depthFt / 2)) } } })} options={[{ value: "rect", label: "Rectangle" }, { value: "L", label: "L-shaped" }]} />
          </Field>
          {design.shape.kind === "L" ? (
            <>
              <Field label="Corner cut away" wide group>
                <Seg label="Corner cut away" value={design.shape.notch.corner} onChange={(c) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, corner: c } } })} options={NOTCH_CORNERS.map((c) => ({ value: c, label: CORNER_LABEL[c] }))} />
              </Field>
              <div className="v5-grid2">
                <Field label="Cut along the house" aside="ft">
                  <NumberInput label="Corner cut along the house, feet" value={design.shape.notch.widthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.widthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, widthFt: n2 } } })} />
                </Field>
                <Field label="Cut out from the house" aside="ft">
                  <NumberInput label="Corner cut out from the house, feet" value={design.shape.notch.depthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.depthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, depthFt: n2 } } })} />
                </Field>
              </div>
              <p className="v5-hint">A back corner is where the house steps out into the deck — a bump-out or a bay.</p>
            </>
          ) : (
            <>
              <Field label="The front edge" wide group>
                <Seg label="The front edge" value={front?.kind ?? "straight"} onChange={(k: FrontKind) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: k === "straight" ? undefined : { kind: k, bulgeFt: front?.bulgeFt ?? 2, clipFt: front?.clipFt ?? 2 } } })} options={(["straight", "curve", "clipped"] as const).map((k) => ({ value: k, label: FRONT_LABEL[k] }))} />
              </Field>
              {front?.kind === "curve" ? (
                <Field label="The bow at the middle" aside="ft · laminated rim, joists cut to the arc" wide>
                  <NumberInput label="How far the front bows out at the middle, feet" value={front.bulgeFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.bulgeFt.min} max={Math.min(DECK_LIMITS.bulgeFt.max, design.shape.widthFt / 3)} onCommit={(n2) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: { ...front, bulgeFt: n2 } } })} />
                </Field>
              ) : front?.kind === "clipped" ? (
                <Field label="Each corner clipped" aside="ft at 45°" wide>
                  <NumberInput label="How much each front corner is clipped, feet" value={front.clipFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.clipFt.min} max={Math.min(DECK_LIMITS.clipFt.max, (design.shape.widthFt - 2) / 2, design.shape.depthFt - 2)} onCommit={(n2) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: { ...front, clipFt: n2 } } })} />
                </Field>
              ) : null}
              <div className="v5-sub">
                <Toggle checked={design.lower.on} onChange={(v) => patch({ lower: { on: v } })}>A lower level in front, a step down</Toggle>
                {design.lower.on ? (
                  <Scope level="lower">
                    <div className="v5-grid2">
                      <Field label="Along the house" aside="ft">
                        <NumberInput label="Lower level width, feet" value={design.lower.widthFt} parse={parseFeet} format={feetText} min={LOWER_LIMITS.widthFt.min} max={design.shape.widthFt} onCommit={(n2) => patch({ lower: { widthFt: n2 } })} />
                      </Field>
                      <Field label="Out from the deck" aside="ft">
                        <NumberInput label="Lower level depth, feet" value={design.lower.depthFt} parse={parseFeet} format={feetText} min={LOWER_LIMITS.depthFt.min} max={LOWER_LIMITS.depthFt.max} onCommit={(n2) => patch({ lower: { depthFt: n2 } })} />
                      </Field>
                      <Field label="Step down" aside={`in. · ${ftIn(design.lower.dropIn)}`}>
                        <NumberInput label="How far down the lower level sits, inches" value={design.lower.dropIn} parse={parseInches} format={(v) => String(Math.round(v * 4) / 4)} min={LOWER_LIMITS.dropIn.min} max={Math.max(LOWER_LIMITS.dropIn.min, design.heightIn - 4)} onCommit={(n2) => patch({ lower: { dropIn: n2 } })} />
                      </Field>
                      <Field label="Set" group>
                        <Seg label="Where the lower level sits" value={design.lower.align} onChange={(a) => patch({ lower: { align: a } })} options={[{ value: "left", label: "Left" }, { value: "centre", label: "Centre" }, { value: "right", label: "Right" }]} />
                      </Field>
                    </div>
                    <p className="v5-hint">One riser (up to 7¾ in.) is a step the lower deck itself makes; more than that wants a stair between the levels — the checks offer one.</p>
                  </Scope>
                ) : null}
              </div>
              {design.shape.kind === "rect" ? (
                <div className="v5-sub">
                  <Toggle checked={design.spa.on} onChange={(v) => patch({ spa: { on: v } })}>A hot-tub spot — the frame under it doubled</Toggle>
                  {design.spa.on ? (
                    <>
                      <div className="v5-grid2">
                        <Field label="Tub, along the house" aside="ft">
                          <NumberInput label="Hot tub width, feet" value={design.spa.widthFt} parse={parseFeet} format={feetText} min={SPA_LIMITS.widthFt.min} max={Math.min(SPA_LIMITS.widthFt.max, design.shape.widthFt - 1)} onCommit={(n2) => patch({ spa: { widthFt: n2 } })} />
                        </Field>
                        <Field label="Tub, out from the house" aside="ft">
                          <NumberInput label="Hot tub depth, feet" value={design.spa.depthFt} parse={parseFeet} format={feetText} min={SPA_LIMITS.depthFt.min} max={Math.min(SPA_LIMITS.depthFt.max, design.shape.depthFt - 1)} onCommit={(n2) => patch({ spa: { depthFt: n2 } })} />
                        </Field>
                        <Field label="Set" group>
                          <Seg label="Where the tub stands" value={design.spa.align} onChange={(a) => patch({ spa: { align: a } })} options={[{ value: "left", label: "Left" }, { value: "centre", label: "Centre" }, { value: "right", label: "Right" }]} />
                        </Field>
                      </div>
                      <p className="v5-hint">Every joist under the tub is doubled and the checks read the frame at the filled weight (≈100 psf). The tub itself is by others — its pad drawing governs.</p>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </More>
      ) : null}

      {scene.house ? (
        <More title="House wall plan" summary={houseWords(design.house)} step="step-house" id="v5-more-house">
          <div className="v5-grid2">
            <Field label="Storeys" group>
              <Seg label="Storeys" value={String(design.house.storeys)} onChange={(v) => setHouse({ storeys: v === "2" ? 2 : 1 })} options={[{ value: "1", label: "One" }, { value: "2", label: "Two" }]} />
            </Field>
            <Field label="Roof" group>
              <Seg label="Roof" value={design.house.roof} onChange={(v: HouseRoof) => setHouse({ roof: v })} options={HOUSE_ROOFS.map((hr) => ({ value: hr, label: HOUSE_ROOF_LABEL[hr] }))} />
            </Field>
          </div>
          <Field label="The back wall and the deck, seen from above — drag anything" wide group lights={null}>
            <div className="v5-quiet-box" onPointerDownCapture={quiet} data-deck-wall-quiet>
              <HouseWallPlan shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} onOpenLarge={openWallLarge} />
            </div>
          </Field>
          <p className={houseNotes(design.shape, design.house).length ? "v5-call v5-call--bad" : "v5-hint"} data-deck-wall-words>{wallWords(design.shape, design.house)}</p>
          <Field label="The wall's shape" wide group>
            <div className="v5-chips" role="group" aria-label="The wall's shape">
              {QUICK_WALLS.map((k) => (
                <button key={k} type="button" className={cx("v5-chip", quickWallOf(design.shape, design.house) === k && "is-on")} aria-pressed={quickWallOf(design.shape, design.house) === k} onClick={() => setHouse(quickWall(k, design.shape, design.house))} data-deck-wall-quick={k}>
                  {QUICK_WALL_LABEL[k]}
                </button>
              ))}
            </div>
          </Field>
          <div className="v5-grid2">
            <Field label="Wall past the deck's left end" aside="ft" lights={lightsFor({ kind: "left" })}>
              <NumberInput label="Wall past the left end, feet" value={design.house.leftFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ leftFt: n2 })} />
            </Field>
            <Field label="Wall past the deck's right end" aside="ft" lights={lightsFor({ kind: "right" })}>
              <NumberInput label="Wall past the right end, feet" value={design.house.rightFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ rightFt: n2 })} />
            </Field>
          </div>
          <div className="v5-rows" data-deck-house-jogs>
            {design.house.jogs.map((j, i) => (
              <div key={j.id} className="v5-row" data-deck-house-jog={j.id}>
                <div className="v5-row-head">
                  <span className="v5-row-title">Step {i + 1}<span className="v5-row-sub">{stepWords(j, design.shape)}</span></span>
                  <button type="button" className="v5-btn v5-btn--sm v5-btn--danger" onClick={() => setHouse({ jogs: design.house.jogs.filter((x) => x.id !== j.id) })} data-deck-house-jog-remove>Remove</button>
                </div>
                <div className="v5-grid3">
                  <Field label="Where, from the deck's left end" aside="ft" lights={lightsFor({ kind: "step", id: j.id })}>
                    <NumberInput label="Step at, feet from the deck's left end" value={j.atFt} parse={parseFeet} format={feetText} min={-design.house.leftFt + 1} max={design.shape.widthFt + design.house.rightFt - 1} onCommit={(n2) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, atFt: n2 } : x)) })} />
                  </Field>
                  <Field label="The wall to its right" group lights={lightsFor({ kind: "part", id: j.id })}>
                    <Seg label="The wall to its right" value={j.dir} onChange={(v: HouseJog["dir"]) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, dir: v } : x)) })} options={[{ value: "toward", label: "Comes out" }, { value: "away", label: "Steps back" }]} />
                  </Field>
                  <Field label="By" aside="ft" lights={lightsFor({ kind: "part", id: j.id })}>
                    <NumberInput label="By, feet" value={j.depthFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.depthFt.min} max={HOUSE_LIMITS.depthFt.max} onCommit={(n2) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, depthFt: n2 } : x)) })} />
                  </Field>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="v5-btn v5-btn--sm v5-self-start" disabled={design.house.jogs.length >= HOUSE_LIMITS.jogs} onClick={() => setHouse({ jogs: [...design.house.jogs, { id: nextJogId(design.house.jogs), atFt: Math.max(2, design.shape.widthFt - 4), dir: "toward", depthFt: 3 }] })} data-deck-house-add-jog>
            + Add a step in the wall
          </button>
          <div className="v5-grid2">
            <Field label="Siding" group>
              <div className="v5-chips" role="group" aria-label="Siding">
                {SIDINGS.map((c) => (
                  <button key={c.id} type="button" className={cx("v5-chip", design.house.siding === c.id && "is-on")} aria-pressed={design.house.siding === c.id} onClick={() => setHouse({ siding: c.id })} data-deck-house-siding={c.id}>
                    <span className="v5-swatch" style={{ background: c.hex }} aria-hidden />
                    {c.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Roof colour" group>
              <div className="v5-chips" role="group" aria-label="Roof colour">
                {ROOF_COLOURS.map((c) => (
                  <button key={c.id} type="button" className={cx("v5-chip", design.house.roofColour === c.id && "is-on")} aria-pressed={design.house.roofColour === c.id} onClick={() => setHouse({ roofColour: c.id })} data-deck-house-roof-colour={c.id}>
                    <span className="v5-swatch" style={{ background: c.hex }} aria-hidden />
                    {c.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </More>
      ) : null}

      <More title="Site and ground" summary={siteSummary} step="step-site" id="v5-more-site">
        {withDeck ? (
          <>
            <Field label="How it meets the house" wide group>
              <Seg label="How it meets the house" value={design.placement} onChange={(p: Placement) => patch({ placement: p })} options={(["attached", "beside", "detached"] as const).map((p) => ({ value: p, label: PLACEMENT_LABEL[p].split(" — ")[0] }))} />
            </Field>
            {design.placement !== "detached" ? (
              <Field label="The house wall there" wide>
                <select className="v5-sel" value={design.wall} onChange={(e) => patch({ wall: e.target.value as DeckDesign["wall"] })}>
                  {WALL_TYPES.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                      {w.ledger ? "" : " — no ledger"}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {design.placement !== "detached" && !wall.ledger ? <p className="v5-hint v5-hint--warn">{wall.why}</p> : null}
            <div className="v5-grid2">
              <Field label="Frost depth" aside="in.">
                <NumberInput label="Frost depth, inches" value={design.frostIn} parse={intText} format={String} min={0} max={96} onCommit={(n2) => patch({ frostIn: n2 }, ["frost"])} />
              </Field>
            </div>
          </>
        ) : (
          <div className="v5-grid2">
            <Field label="Frost depth" aside="in.">
              <NumberInput label="Frost depth, inches" value={design.frostIn} parse={intText} format={String} min={0} max={96} onCommit={(n2) => patch({ frostIn: n2 }, ["frost"])} />
            </Field>
            <Field label="Footings stand above grade" aside="in.">
              <NumberInput label="Top of the footings above the ground, inches" value={design.footing.aboveGradeIn} parse={intText} format={String} min={DECK_LIMITS.aboveGradeIn.min} max={DECK_LIMITS.aboveGradeIn.max} onCommit={(n2) => patch({ footing: { aboveGradeIn: n2 } })} />
            </Field>
          </div>
        )}
        <div className="v5-grid2">
          <Field label="Design load" aside={design.site.groundSnowPsf > 40 ? `snow here ${design.site.groundSnowPsf} psf` : "live or snow"}>
            <select className="v5-sel" value={design.loadPsf} onChange={(e) => patch({ loadPsf: Number(e.target.value) as LoadPsf }, ["load"])}>
              {LOADS.map((l) => (
                <option key={l} value={l}>
                  {l === 40 ? "40 psf — live load" : `${l} psf ground snow`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Soil bears">
            <select className="v5-sel" value={design.soilPsf} onChange={(e) => patch({ soilPsf: Number(e.target.value) as SoilPsf })}>
              <option value={1500}>1,500 psf (code default)</option>
              <option value={2000}>2,000 psf</option>
              <option value={3000}>3,000 psf or more</option>
            </select>
          </Field>
        </div>
        <div className="v5-sub" data-deck-site>
          <div className="v5-sub-title">The ground</div>
          <div className="v5-grid2">
            <Field label="Falls away from the house" aside={`in. over ${design.shape.depthFt} ft`}>
              <NumberInput label="How far the ground falls away from the house across the deck, inches" value={design.site.slope.outDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, outDropIn: n2 } } })} />
            </Field>
            <Field label="Falls left to right" aside={`in. over ${design.shape.widthFt} ft`}>
              <NumberInput label="How far the ground falls left to right across the deck, inches" value={design.site.slope.acrossDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, acrossDropIn: n2 } } })} />
            </Field>
          </div>
          <div className="v5-acts">
            <button type="button" className="v5-btn v5-btn--sm" onClick={() => void readGround()} disabled={siteBusy || address.trim().length < 8} data-deck-read-ground>{siteBusy ? "Reading the lidar…" : "Read the ground from the address"}</button>
            {design.site.slope.outDropIn || design.site.slope.acrossDropIn ? <button type="button" className="v5-btn v5-btn--sm v5-btn--quiet" onClick={() => patch({ site: { ...design.site, slope: { outDropIn: 0, acrossDropIn: 0 } } })}>Level</button> : null}
          </div>
          {siteNote ? <p className="v5-hint">{siteNote}</p> : null}
          <details className="v5-sub-more" data-deck-facts>
            <summary>
              What the code and the site say here
              <Chevron />
            </summary>
            <ul className="v5-facts">
              <li data-deck-code>{site.codeLine}</li>
              {site.basis.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
              {design.site.termite ? <li>Termite hazard here: {TERMITE_LABEL[design.site.termite]}.</li> : null}
            </ul>
          </details>
        </div>
        {!withDeck && design.floor === "ground" && r.attach !== "wall" ? <Toggle checked={design.footing.frostAlways} onChange={(v) => patch({ footing: { frostAlways: v } })}>Dig to the frost line anyway</Toggle> : null}
      </More>

      {withDeck && frame ? (
        <More title="Structure" summary={frameSummary} step="Frame" id="v5-more-frame">
          <Field label="Framing lumber" wide>
            <select className="v5-sel" value={design.custom.species ? CUSTOM : design.framing.species} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("species") : patch({ framing: { species: e.target.value as DeckDesign["framing"]["species"] }, custom: { species: undefined } }, ["species"]))} data-deck-pick="species">
              {speciesOptions}
              <option value={CUSTOM}>{CUSTOM_LABEL}</option>
            </select>
          </Field>
          {design.custom.species ? (
            <CustomBox slot="species" title="Framing lumber" product={design.custom.species} unit={null} fresh={freshCustom === "species"} onDone={freshDone} onChange={(p) => setCustom("species", p)} onBack={() => setCustom("species", undefined)} note={`Named as typed on the plans and the material list. It spans by the code's tables for ${(FRAMING_SPECIES.find((f) => f.id === design.framing.species)?.label ?? "the lumber below").toLowerCase()} and is priced as that — your own lumber prices go under Your prices.`}>
              <Field label="Spans and prices as" wide>
                <select className="v5-sel" value={design.framing.species} onChange={(e) => patch({ framing: { species: e.target.value as DeckDesign["framing"]["species"] } }, ["species"])} data-deck-like="species">
                  {speciesOptions}
                </select>
              </Field>
            </CustomBox>
          ) : (
            <p className="v5-hint">{frame.species.note}</p>
          )}
          <Field label="Joists" aside={design.framing.joist === "auto" ? `picked: ${frame.joistSize}` : undefined} wide group>
            <Seg label="Joists" value={design.framing.joist} onChange={(v) => patch({ framing: { joist: v } })} options={[{ value: "auto", label: "Auto" }, ...(["2x6", "2x8", "2x10", "2x12"] as const).map((j) => ({ value: j, label: j }))]} />
          </Field>
          <Field label="Joist spacing" aside={design.framing.spacingIn === "auto" ? `${frame.spacingIn} in. on center` : "on center"} wide group>
            <Seg label="Joist spacing" value={design.framing.spacingIn} onChange={(v) => patch({ framing: { spacingIn: v } })} options={[{ value: "auto", label: "Auto" }, { value: 12, label: '12"' }, { value: 16, label: '16"' }, { value: 24, label: '24"' }]} />
          </Field>
          <div className="v5-grid2">
            <Field label="Beam size" aside={design.framing.beam === "auto" ? `picked: ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")}` : undefined}>
              <select className="v5-sel" value={design.framing.beam} onChange={(e) => patch({ framing: { beam: e.target.value as DeckDesign["framing"]["beam"] } })}>
                <option value="auto">Auto — least cost</option>
                {(frame.beamKind === "solid" ? SOLID_BEAMS : BUILT_UP_CHOICES).map((b) => (
                  <option key={b} value={b}>{b.includes("-") ? `${b[0]}-ply ${b.slice(2)}` : b}</option>
                ))}
              </select>
            </Field>
            <Field label="Posts">
              <select className="v5-sel" value={design.framing.post} onChange={(e) => patch({ framing: { post: e.target.value as DeckDesign["framing"]["post"] } })}>
                {POST_SIZES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Footings" wide group>
            <Seg label="Footings" value={design.footing.type} onChange={(v) => patch({ footing: { type: v } })} options={[{ value: "poured", label: "Poured concrete" }, { value: "pier-block", label: "Precast pier blocks" }]} />
          </Field>
          <details className="v5-sub-more" data-deck-more-frame>
            <summary>
              More framing choices
              <span className="v5-sub-sum">{frameMoreWords}</span>
              <Chevron />
            </summary>
            <Field label="Beams" aside={design.framing.beamStyle === "auto" ? (frame.beamStyle === "flush" ? "picked: flush" : "picked: under the joists") : undefined} wide group>
              <Seg label="Beams" value={design.framing.beamStyle} onChange={(v) => patch({ framing: { beamStyle: v } })} options={[{ value: "auto", label: "Auto" }, { value: "dropped", label: "Under the joists" }, { value: "flush", label: "Flush" }]} />
            </Field>
            <div className="v5-grid2">
              <Field label="Beam made of">
                {/* What is built, not only what was asked (owner, 2026-10-11): solid 4x beams have no code span table for every
                    lumber and load, and then the frame builds them up from 2x — the select says so. */}
                <select className="v5-sel" value={frame.beamKind} onChange={(e) => patch({ framing: { beamKind: e.target.value as DeckDesign["framing"]["beamKind"], beam: "auto" } })} data-deck-beam-kind={frame.beamKind}>
                  <option value="solid" disabled={!solidBeamTabulated(frame.load, frame.group)}>{solidBeamTabulated(frame.load, frame.group) ? "Solid 4x" : "Solid 4x — not in the code's tables for this lumber and load"}</option>
                  <option value="built-up">Built up from 2x</option>
                </select>
              </Field>
              <Field label="Joists past the beam" aside={design.framing.overhangFt === "auto" ? `auto: ${ftIn(frame.zones[0].frontCantIn)}` : "ft"}>
                <select className="v5-sel" value={String(design.framing.overhangFt)} onChange={(e) => patch({ framing: { overhangFt: e.target.value === "auto" ? "auto" : Number(e.target.value) } })}>
                  <option value="auto">Auto — up to 2 ft</option>
                  {[0, 0.5, 1, 1.5, 2, 2.5, 3].map((v) => (
                    <option key={v} value={v}>{v === 0 ? "None" : feetText(v).replace(/^(\d+)$/, "$1 ft")}</option>
                  ))}
                </select>
              </Field>
            </div>
            {frame.beamKindNote ? <p className="v5-call v5-call--warn" data-deck-beam-note>{frame.beamKindNote}</p> : null}
            <div className="v5-stack">
              <Toggle checked={design.framing.doubleRim} onChange={(v) => patch({ framing: { doubleRim: v } })}>Doubled rim and outside joists</Toggle>
              <Toggle checked={design.framing.joistTape} onChange={(v) => patch({ framing: { joistTape: v } })}>Joist tape on every top</Toggle>
              <Toggle checked={design.framing.braces} onChange={(v) => patch({ framing: { braces: v } })}>Knee braces at corner posts over 2 ft</Toggle>
              <Toggle checked={design.framing.blocking === "mid-span"} onChange={(v) => patch({ framing: { blocking: v ? "mid-span" : "auto" } })}>Mid-span blocking on spans over 8 ft</Toggle>
              {design.heightIn >= 84 ? <Toggle checked={design.extras.underDeckDrain} onChange={(v) => patch({ extras: { underDeckDrain: v } })}>Under-deck drainage — a dry room below</Toggle> : null}
            </div>
            {design.placement === "attached" ? (
              <div className="v5-grid2">
                <Field label="Ledger fastened with">
                  <select className="v5-sel" value={design.ledger.fastener} onChange={(e) => patch({ ledger: { fastener: e.target.value as DeckDesign["ledger"]["fastener"] } })}>
                    {wall.fasteners.map((f) => (
                      <option key={f} value={f}>{LEDGER_FASTENER_LABEL[f]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Ties to the house">
                  <select className="v5-sel" value={design.ledger.lateral} onChange={(e) => patch({ ledger: { lateral: e.target.value as "two" | "four" } })}>
                    <option value="two">Two 1,500-lb hold-downs</option>
                    <option value="four">Four 750-lb ties</option>
                  </select>
                </Field>
              </div>
            ) : null}
            {design.placement !== "attached" ? <Toggle checked={design.footing.frostAlways} onChange={(v) => patch({ footing: { frostAlways: v } })}>Dig to the frost line anyway</Toggle> : null}
          </details>
        </More>
      ) : null}

      {withDeck && frame && pkg.takeoff.surface ? (
        <More title="Board pattern and trim" summary={trimSummary} step="Surface" id="v5-more-trim">
          <p className="v5-hint">Joists no more than {frame.decking.maxSpacingIn.square} in. apart ({frame.decking.maxSpacingIn.diagonal} in. on the diagonal) — {frame.decking.sourceNote}.</p>
          {regional ? <p className="v5-hint" data-deck-regional={regional.region}>{regionalWords(regional)} Builder surveys by region; remodels still lean on wood.</p> : null}
          <Field label="Pattern" wide group>
            <Seg label="Pattern" value={design.decking.pattern} onChange={(v) => patch({ decking: { pattern: v, diagonal: v !== "straight" } })} options={(["straight", "diagonal", "herringbone"] as const).map((v) => ({ value: v, label: PATTERN_LABEL[v] }))} />
          </Field>
          <Field label="Picture-frame border" wide group>
            <Seg label="Picture-frame border" value={design.decking.border} onChange={(v) => patch({ decking: { border: v } })} options={[{ value: 0, label: "None" }, { value: 1, label: "One board" }, { value: 2, label: "Two boards" }]} />
          </Field>
          <div className="v5-grid3">
            <Field label="Fastened with">
              <select className="v5-sel" value={design.custom.fastening ? CUSTOM : design.decking.fastening} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("fastening") : patch({ decking: { fastening: e.target.value as DeckDesign["decking"]["fastening"] }, custom: { fastening: undefined } }))} data-deck-pick="fastening">
                <option value="auto">Auto — {pkg.takeoff.surface.fastening === "hidden" ? "hidden clips" : "screws"}</option>
                <option value="screws">Deck screws</option>
                {frame.decking.hiddenFasteners ? <option value="hidden">Hidden clips</option> : null}
                <option value={CUSTOM}>{CUSTOM_LABEL}</option>
              </select>
            </Field>
            <Field label="Fascia">
              <select className="v5-sel" value={design.custom.fascia && pkg.takeoff.surface.fascia.on ? CUSTOM : design.decking.fascia} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("fascia") : patch({ decking: { fascia: e.target.value as DeckDesign["decking"]["fascia"] }, custom: { fascia: undefined } }))} data-deck-pick="fascia">
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
                <Field label="Counted as" wide group>
                  <Seg label="Fastening counted as" value={pkg.takeoff.surface.fastening} onChange={(v) => patch({ decking: { fastening: v } })} options={[{ value: "screws", label: "Face screws" }, { value: "hidden", label: "Hidden clips" }]} />
                </Field>
              ) : null}
            </CustomBox>
          ) : null}
          {design.custom.fascia && pkg.takeoff.surface.fascia.on ? (
            <CustomBox slot="fascia" title="Fascia" product={design.custom.fascia} unit="ft" fresh={freshCustom === "fascia"} onDone={freshDone} onChange={(p) => setCustom("fascia", p)} onBack={() => setCustom("fascia", undefined)} note="Priced per foot of fascia board, the stair risers too, bought in 12-ft lengths." />
          ) : null}
        </More>
      ) : null}

      {withDeck && design.rail.type !== "none" ? (
        <More title="Railing details" summary={railMoreSummary} step="step-stairs" id="v5-more-rail">
          <div className="v5-grid2">
            <Field label="Infill" aside={design.rail.infill === "auto" ? `picked: ${RAIL_INFILL_LABEL[structure.rails.infill].toLowerCase()}` : undefined}>
              <select className="v5-sel" value={design.rail.infill} onChange={(e) => patch({ rail: { infill: e.target.value as DeckDesign["rail"]["infill"] } })}>
                {infills.map((v) => (
                  <option key={v} value={v}>{v === "auto" ? "Auto" : RAIL_INFILL_LABEL[v]}</option>
                ))}
              </select>
            </Field>
            <Field label="Posts apart" aside="ft" group>
              <Seg label="Rail posts apart" value={design.rail.postSpacingFt} onChange={(v) => patch({ rail: { postSpacingFt: v } })} options={[{ value: 4, label: "4" }, { value: 6, label: "6" }, { value: 8, label: "8" }]} />
            </Field>
          </div>
          <div className="v5-stack">
            {woodRail ? <Toggle checked={design.rail.cap} onChange={(v) => patch({ rail: { cap: v } })}>A flat 2x6 drink cap</Toggle> : null}
            {design.lower.on ? <Toggle checked={design.rail.lowerLevel} onChange={(v) => patch({ rail: { lowerLevel: v } })}>Rail on the lower level too</Toggle> : null}
          </div>
          {structure.rails.on ? <p className="v5-hint">{railWords(structure.rails)}. Lit post caps and step lights are under Lights, outlets and heaters.</p> : null}
        </More>
      ) : null}

      {withRoof && roof ? (
        <More title={design.structure === "pergola" ? "Pergola details" : "Roof details"} summary={roofSummary} step="step-roof" id="v5-more-roof">
          {canAttach ? (
            <Field label="It stands" wide group>
              <Seg label="On the house or free" value={r.attach} onChange={(a) => rp({ attach: a })} options={[{ value: "wall", label: "On the house wall" }, { value: "free", label: "Free-standing" }]} />
            </Field>
          ) : null}
          {withDeck ? outlineBlock(false) : null}
          <div className="v5-sub">
            <div className="v5-sub-title">Posts and headers</div>
            <div className="v5-grid2">
              <Field label="Height to the headers" aside={`in. · ${ftIn(r.eaveHeightIn)}`}>
                <NumberInput label="Height from the floor to the underside of the headers, inches" value={r.eaveHeightIn} parse={parseInches} format={String} min={ROOF_LIMITS.eaveHeightIn.min} max={ROOF_LIMITS.eaveHeightIn.max} onCommit={(n2) => rp({ eaveHeightIn: n2 })} />
              </Field>
              <Field label="Posts" group>
                <Seg label="Roof posts" value={r.post} onChange={(p) => rp({ post: p })} options={(["4x4", "6x6", "8x8"] as const).map((p) => ({ value: p, label: p }))} />
              </Field>
            </div>
            <div className="v5-chips" role="group" aria-label="Usual header heights">
              {EAVE_PRESETS.map((h) => (
                <button key={h.label} type="button" className={cx("v5-chip", r.eaveHeightIn === h.inches && "is-on")} aria-pressed={r.eaveHeightIn === h.inches} onClick={() => rp({ eaveHeightIn: h.inches })}>
                  {h.label} <span>to the headers</span>
                </button>
              ))}
            </div>
            <div className="v5-grid2">
              <Field label="Headers (beams on the posts)" aside={r.header === "auto" ? `picked: ${[...new Set(roof.headers.map((h) => h.spec.size))].join(", ") || "—"}` : undefined}>
                <select className="v5-sel" value={r.header} onChange={(e) => rp({ header: e.target.value as RoofDesign["header"] })}>
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
                <select className="v5-sel" value={r.overhangIn} onChange={(e) => rp({ overhangIn: Number(e.target.value) })}>
                  {OVERHANGS.map((o) => (
                    <option key={o} value={o}>{o === 0 ? "None" : `${o} in.`}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Toggle checked={r.braces} onChange={(v) => rp({ braces: v })}>Knee braces at the posts</Toggle>
            <Field label="Walls between the posts" wide group>
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
                <Field label="Built like" wide group>
                  <Seg label="Walls built like" value={r.walls.fill} onChange={(v) => rp({ walls: { ...r.walls, fill: v } })} options={(["screen", "lattice", "solid"] as const).map((v) => ({ value: v, label: WALL_FILL_LABEL[v].split(",")[0] }))} />
                </Field>
              </CustomBox>
            ) : null}
            {r.walls.fill !== "none" ? (
              <Field label="On how many sides" aside={`of ${roof.ring.length - (roof.attach === "wall" ? 1 : 0)} open`}>
                <NumberInput label="How many sides get walls" value={r.walls.sides} parse={intText} format={String} min={1} max={Math.max(1, roof.ring.length - (roof.attach === "wall" ? 1 : 0))} onCommit={(n2) => rp({ walls: { ...r.walls, sides: n2 } })} />
              </Field>
            ) : null}
          </div>
          <div className="v5-sub">
            <div className="v5-sub-title">{design.structure === "pergola" ? "Rafters and slats" : "Rafters and ridge"}</div>
            {design.structure !== "pergola" ? (
              <Field label="Pitch" aside={`${r.pitch}:12 · ${Math.round(Math.atan(r.pitch / 12) * (180 / Math.PI))}°`} wide group>
                <Seg label="Pitch" value={r.pitch} onChange={(p) => rp({ pitch: p })} options={PITCHES.map((p) => ({ value: p, label: `${p}:12` }))} />
              </Field>
            ) : null}
            <Field label="Rafters" aside={roof.trusses ? "trusses frame this roof" : r.rafter === "auto" ? `picked: ${roof.rafters.size}` : undefined} wide group>
              <Seg label="Rafters" value={r.rafter} onChange={(v) => rp({ rafter: v })} options={[{ value: "auto", label: "Auto" }, ...(["2x6", "2x8", "2x10", "2x12"] as const).map((j) => ({ value: j, label: j }))]} />
            </Field>
            <Field label="Rafter spacing" aside="on center" wide group>
              <Seg label="Rafter spacing" value={r.rafterSpacingIn} onChange={(v) => rp({ rafterSpacingIn: v })} options={[{ value: 12, label: '12"' }, { value: 16, label: '16"' }, { value: 24, label: '24"' }]} />
            </Field>
            {r.kind === "gable" || r.kind === "hip" || r.kind === "gambrel" ? (
              <Field label="At the ridge" aside={r.ridge === "auto" ? (roof.trusses ? "picked: trusses" : roof.ridge ? `picked: ${roof.ridge.kind === "beam" ? "ridge beam" : "ridge board"}` : undefined) : undefined} wide group>
                <Seg label="At the ridge" value={r.ridge} onChange={(v) => rp({ ridge: v })} options={[{ value: "auto", label: "Auto" }, { value: "beam", label: "Ridge beam", title: r.kind === "hip" ? "A beam on two king posts, each standing on a cross beam from eave header to eave header; the ceiling stays open" : "The rafters bear on a beam; the ceiling stays open" }, { value: "board", label: "Ridge board + ties", title: "A board between the rafters, with rafter ties every 4 ft" }, ...(r.kind === "gable" ? [{ value: "trusses" as const, label: "Trusses", title: "Manufactured trusses 24 in. on center, one piece header to header — designed and stamped by the truss maker" }] : [])]} />
              </Field>
            ) : null}
            {/* CROSS BEAMS (2026-10-12): under a gable's ridge beam, each from eave header to eave header with a king post. */}
            {roof.kind === "gable" && roof.ridge?.kind === "beam" && !roof.trusses ? (
              <Field label="Cross beams under the ridge" aside={roof.crossBeams ? `the ridge spans ${ftIn(roof.ridge.spanIn)} between king posts` : "the ridge spans end to end"} wide group>
                <Seg label="Cross beams under the ridge" value={r.crossBeams} onChange={(v) => rp({ crossBeams: v })} options={[0, 1, 2, 3].map((v) => ({ value: v, label: v === 0 ? "None" : String(v), title: v === 0 ? "The ridge beam spans from one end to the other on king posts" : `${v} cross beam${v > 1 ? "s" : ""} from eave to eave, each with a king post under the ridge and a post under each end` }))} />
              </Field>
            ) : null}
            {roof.kind === "hip" && roof.attach === "free" && roof.ridge?.kind === "beam" ? (
              <p className="v5-hint" data-deck-hip-cross>The ridge beam stands on two king posts, each on a cross beam from eave header to eave header, with a post under each end of the cross beams. Nothing pushes the headers apart, so no ties.</p>
            ) : null}
            {roof.ringTensionLb > 0 ? (
              <p className="v5-hint" data-deck-ring>The hips push the corners out — about {roof.ringTensionLb.toLocaleString("en-US")} lb at each header joint. A tension strap across every joint holds the headers as a ring; they are in the material list.</p>
            ) : null}
            {design.structure === "pergola" && r.pergolaStyle !== "louvered" ? (
              <div className="v5-grid2">
                <Field label="Slats" group>
                  <Seg label="Slats" value={r.slats.size} onChange={(v) => rp({ slats: { ...r.slats, size: v } })} options={(["2x2", "2x4", "2x6"] as const).map((v) => ({ value: v, label: v }))} />
                </Field>
                <Field label="Slat spacing" aside="in. apart">
                  <NumberInput label="Slat spacing, inches" value={r.slats.spacingIn} parse={intText} format={String} min={ROOF_LIMITS.slatSpacingIn.min} max={ROOF_LIMITS.slatSpacingIn.max} onCommit={(n2) => rp({ slats: { ...r.slats, spacingIn: n2 } })} />
                </Field>
              </div>
            ) : null}
            <Field label="Roof load" aside={r.load === "auto" ? `from the site: ${roof.roofLoad} psf` : undefined} wide>
              <select className="v5-sel" value={String(r.load)} onChange={(e) => rp({ load: e.target.value === "auto" ? "auto" : (Number(e.target.value) as RoofDesign["load"]) })}>
                <option value="auto">Auto — follows the ground snow here</option>
                <option value="20">20 psf roof live load</option>
                <option value="30">30 psf ground snow</option>
                <option value="50">50 psf ground snow</option>
                <option value="70">70 psf ground snow</option>
              </select>
            </Field>
          </div>
          {design.structure !== "pergola" ? (
            <>
              <div className="v5-sub">
                <div className="v5-sub-title">Roofing and ceiling</div>
                <div className="v5-grid2">
                  <Field label="Roofing">
                    <select
                      className="v5-sel"
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
                    <Field label="Metal goes on" group>
                      <Seg label="Metal goes on" value={r.roofDeck} onChange={(v) => rp({ roofDeck: v })} options={[{ value: "sheathing", label: "Sheathing" }, { value: "purlins", label: "Purlins" }]} />
                    </Field>
                  ) : null}
                  <Field label="Ceiling">
                    <select
                      className="v5-sel"
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
                  <CustomBox slot="roofing" title="Roofing" product={design.custom.roofing} unit="square" fresh={freshCustom === "roofing"} onDone={freshDone} onChange={(p) => setCustom("roofing", p)} onBack={() => setCustom("roofing", undefined)} note={`Priced per square — 100 sq ft of roof; this roof is ${roof.squares} squares. The underlayment, the flashing and the nails follow what it goes on like.`}>
                    <Field label="Goes on like" wide>
                      <select className="v5-sel" value={r.roofing} onChange={(e) => rp({ roofing: e.target.value as RoofDesign["roofing"] })} data-deck-like="roofing">
                        {roofingOptions}
                      </select>
                    </Field>
                  </CustomBox>
                ) : null}
                {design.custom.ceiling && r.ceiling !== "none" ? (
                  <CustomBox slot="ceiling" title="Ceiling" product={design.custom.ceiling} unit="sq ft of ceiling" fresh={freshCustom === "ceiling"} onDone={freshDone} onChange={(p) => setCustom("ceiling", p)} onBack={() => setCustom("ceiling", undefined)} note="Priced per square foot of ceiling, 10% waste on top.">
                    <Field label="Looks like" wide group>
                      <Seg label="Ceiling looks like" value={r.ceiling} onChange={(v) => rp({ ceiling: v })} options={(["tongue-groove", "beadboard"] as const).map((c) => ({ value: c, label: CEILING_LABEL[c] }))} />
                    </Field>
                  </CustomBox>
                ) : null}
                {r.kind !== "shed" ? <Toggle checked={r.cupola} onChange={(v) => rp({ cupola: v })}>Cupola at the peak</Toggle> : null}
              </div>
              <div className="v5-sub">
                <div className="v5-sub-title">Fascia, soffit and gutters</div>
                <div className="v5-stack">
                  <Toggle checked={r.fascia.eave} onChange={(v) => rp({ fascia: { ...r.fascia, eave: v } })}>Fascia on the eaves ({Math.round(roof.eaveFt)} ft)</Toggle>
                  {roof.rakeFt > 0 ? <Toggle checked={r.fascia.rake} onChange={(v) => rp({ fascia: { ...r.fascia, rake: v } })}>Rake boards on the gable ends ({Math.round(roof.rakeFt)} ft)</Toggle> : null}
                  <Toggle checked={r.soffit} onChange={(v) => rp({ soffit: v })}>Vented soffit under the overhang</Toggle>
                </div>
                <div className="v5-grid2">
                  <Field label="Fascia finish">
                    <select
                      className="v5-sel"
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
                      className="v5-sel"
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
                      <select className="v5-sel" value={r.gutters.kind} onChange={(e) => rp({ gutters: { ...r.gutters, kind: e.target.value as RoofDesign["gutters"]["kind"] } })} data-deck-like="gutters">
                        {GUTTER_KINDS.filter((g) => g !== "none").map((g) => (
                          <option key={g} value={g}>{GUTTER_LABEL[g]}</option>
                        ))}
                      </select>
                    </Field>
                  </CustomBox>
                ) : null}
                {r.gutters.kind !== "none" ? <Toggle checked={r.gutters.guards} onChange={(v) => rp({ gutters: { ...r.gutters, guards: v } })}>Gutter guards</Toggle> : null}
              </div>
            </>
          ) : null}
        </More>
      ) : null}

      <More title="Lights, outlets and heaters" summary={electricSummary} step="step-electrical" id="v5-more-electric">
        <p className="v5-hint">Tap what the {what.toLowerCase()} gets: each goes where it usually does, or press Place in 3D and touch the spot. A fixture the client buys is drawn as a sample and left to be determined.</p>
        <div className="v5-chips" role="group" aria-label="Add a fixture">
          {FIXTURE_CHIPS.map((k) => (
            <button key={k} type="button" className="v5-chip" disabled={design.electrical.fixtures.length >= ELECTRICAL_LIMITS.fixtures} onClick={() => setFixtures((list) => [...list, defaultFixture(`e${list.length + 1}-${Date.now().toString(36).slice(-3)}`, k)])} data-deck-add-fixture={k}>
              + {FIXTURE_SHORT[k]}
            </button>
          ))}
        </div>
        <div className="v5-rows">
          {design.electrical.fixtures.map((f) => {
            const placedOnes = structure.electrical.fixtures.filter((pf) => pf.id === f.id || pf.id.startsWith(`${f.id}-`));
            return (
              <Scope key={f.id} fixture={f.id}>
                <div className="v5-row" data-deck-fixture={f.id}>
                  <div className="v5-row-head">
                    <span className="v5-row-title">{f.custom ? f.custom.name : FIXTURE_SHORT[f.kind]}{f.supply === "client" ? <span className="v5-stamp v5-stamp--info">by the client · TBD</span> : null}</span>
                    <button type="button" className="v5-btn v5-btn--sm v5-btn--danger" onClick={() => setFixtures((list) => list.filter((x) => x.id !== f.id))}>Remove</button>
                  </div>
                  <div className="v5-grid2">
                    <Field label="What">
                      <select
                        className="v5-sel"
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
                    <Field label="Who buys the fixture" aside={f.supply === "client" ? "wiring and hanging stay in the price" : undefined} group>
                      <Seg label="Who buys the fixture" value={f.supply} onChange={(v) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, supply: v } : x)))} options={[{ value: "we", label: "We supply it" }, { value: "client", label: "The client" }]} />
                    </Field>
                    {f.kind !== "led-strip" && f.kind !== "post-cap" && f.kind !== "step-light" && f.kind !== "string-light" ? (
                      <Field label="How many">
                        <NumberInput label="How many" value={f.qty} parse={intText} format={String} min={1} max={ELECTRICAL_LIMITS.qty.max} onCommit={(n2) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, qty: n2 } : x)))} />
                      </Field>
                    ) : null}
                    {f.kind === "heater" ? (
                      <Field label="Heater" group>
                        <Seg label="Heater voltage" value={f.volts240 ? "240" : "120"} onChange={(v) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, volts240: v === "240" } : x)))} options={[{ value: "120", label: "1.5 kW, 120 V" }, { value: "240", label: "4 kW, 240 V" }]} />
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
                        <select className="v5-sel" value={f.kind} onChange={(e) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, kind: e.target.value as FixtureKind, at: null } : x)))} data-deck-like="fixture">
                          {fixtureOptions}
                        </select>
                      </Field>
                    </CustomBox>
                  ) : null}
                  <div className="v5-acts">
                    <button type="button" className={cx("v5-btn v5-btn--sm", placing?.kind === "fixture" && placing.id === f.id && "is-on")} onClick={() => { setPlacing(placing?.kind === "fixture" && placing.id === f.id ? null : { kind: "fixture", id: f.id }); setView("3d"); }} data-deck-place-fixture={f.id}>
                      {placing?.kind === "fixture" && placing.id === f.id ? "Click the 3D…" : f.at ? "Move it in 3D" : "Place in 3D"}
                    </button>
                    {f.at ? <button type="button" className="v5-btn v5-btn--sm v5-btn--quiet" onClick={() => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, at: null } : x)))}>Back to the usual spot</button> : null}
                    <span className="v5-mono">{f.at ? `on the ${f.at.on}` : placedOnes.length ? `${placedOnes.length === 1 ? "placed" : `${placedOnes.length} placed`} where it usually goes` : ""}</span>
                  </div>
                </div>
              </Scope>
            );
          })}
        </div>
        {structure.electrical.on ? (
          <>
            <div className="v5-grid2">
              <Field label="Panel to the structure" aside="ft of feed">
                <NumberInput label="Feet from the house's panel to the structure" value={design.electrical.feedFt} parse={intText} format={String} min={ELECTRICAL_LIMITS.feedFt.min} max={ELECTRICAL_LIMITS.feedFt.max} onCommit={(n2) => patch({ electrical: { ...design.electrical, feedFt: n2 } })} />
              </Field>
              <Field label="The feed comes from the" group>
                <Seg label="Panel side" value={design.electrical.panelSide} onChange={(v) => patch({ electrical: { ...design.electrical, panelSide: v } })} options={[{ value: "left", label: "Left end" }, { value: "right", label: "Right end" }]} />
              </Field>
            </div>
            <Toggle checked={design.electrical.timer} onChange={(v) => patch({ electrical: { ...design.electrical, timer: v } })}>A timer or photocell on the lights</Toggle>
            <p className="v5-hint">{electricalWords(structure.electrical)} · {structure.electrical.boxes} boxes · {structure.electrical.switches} switches{structure.electrical.lv ? ` · ${structure.electrical.lv.transformers} transformer${structure.electrical.lv.transformers > 1 ? "s" : ""}` : ""}{structure.electrical.trenchFt ? ` · ${structure.electrical.trenchFt} ft of trench` : ""}. Turn on Night over the 3D to see them lit.</p>
          </>
        ) : null}
      </More>

      {withDeck ? (
        <More title="Old deck and hardware" summary={extrasMoreSummary} id="v5-more-extras">
          <div className="v5-grid2" data-deck-extras>
            <Field label="Tear out an old deck" aside="sq ft">
              <NumberInput label="Old deck to tear out, square feet" value={design.extras.demoSqFt} parse={intText} format={String} min={0} max={4000} onCommit={(n2) => patch({ extras: { demoSqFt: n2 } })} />
            </Field>
          </div>
          <Toggle checked={design.extras.stainless} onChange={(v) => patch({ extras: { stainless: v } })}>Stainless connectors — within 300 ft of salt water</Toggle>
        </More>
      ) : null}

      {PHOTO_ENABLED ? (
        <More title="Photo of the house" summary={photoSummary} id="v5-more-photo">
          <p className="v5-hint">A picture of the back of the house, taken square on from the yard. The studio finds the wall, the door and the windows, cuts the picture to the wall and sets the {what.toLowerCase()} against it.</p>
          <div className="v5-acts">
            <button type="button" className={cx("v5-btn v5-btn--sm", !design.photo && "v5-btn--primary")} onClick={pickPhoto} disabled={photoBusy} data-deck-photo-add>
              {photoBusy ? (photoStage ?? "Saving the picture…") : design.photo ? "Another photo" : "Add a photo"}
            </button>
            {design.photo ? (
              <>
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => setView("photo")}>Place it on the photo</button>
                <button type="button" className="v5-btn v5-btn--sm" onClick={removePhoto}>Remove</button>
              </>
            ) : null}
          </div>
          {photoError ? <p className="v5-call v5-call--bad" role="alert">{photoError}</p> : null}
        </More>
      ) : null}
    </div>
  );

  /* ── the finish: the calls that matter before it goes out, and the three ways out ── */
  const proposalButtons =
    linked && !linked.lock ? (
      <>
        <button type="button" className="v5-btn v5-btn--primary v5-btn--big" disabled={!!busy || !behind} onClick={() => askUpdate("bottom")} data-deck-update="bottom">
          {busy === "update" ? "Updating…" : !behind ? `${linked.ref} is up to date` : summary.fail ? "Update anyway" : `Update ${linked.ref}`}
        </button>
        <button type="button" className="v5-btn" disabled={!!busy} onClick={convert} data-deck-convert-new>
          {busy === "convert" ? "Making the proposal…" : "New proposal"}
        </button>
      </>
    ) : (
      <button type="button" className="v5-btn v5-btn--primary v5-btn--big" disabled={!!busy} onClick={convert} data-deck-convert>
        {busy === "convert" ? "Making the proposal…" : linked ? "Save as a new proposal" : summary.fail ? "Make proposal anyway" : "Make proposal"}
      </button>
    );
  const finish = (
    <div className="v5-finish" data-v5-finish>
      {summary.fail ? (
        <p className="v5-call v5-call--bad">
          <b>{summary.fail === 1 ? "One check fails" : `${summary.fail} checks fail`}.</b> Fix the frame before the client sees it —{" "}
          <button type="button" className="v5-link" onClick={() => setChecksOpen(true)}>see the checks</button>.
        </p>
      ) : null}
      {error && actAt === "bottom" ? <p className="v5-call v5-call--bad" role="alert">{error}</p> : null}
      {confirmAt === "bottom" ? confirmBox : null}
      {linked && updated && !behind ? (
        <p className="v5-call v5-call--pass" role="status" data-deck-updated>
          <b>{linked.ref} updated {ago(updated.at)}.</b> {updatedWords}{" "}
          <a href={`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}`} onClick={go(`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}`)}>Open the proposal</a>
        </p>
      ) : null}
      <div className="v5-finish-row">
        <span className="v5-finish-price" aria-hidden="true">{money(pkg.subtotal)}</span>
        {proposalButtons}
        <button type="button" className="v5-btn" onClick={saveNow} disabled={saveState === "saving"} data-v5-save-draft>
          {saveState === "saving" ? "Saving…" : "Save draft"}
        </button>
        <SendToClient design={design} address={address} title={draftTitle.trim()} clientId={clientId} proposalId={linkedId} unseen={inbox.length} onOpened={(token) => setInbox((list) => list.filter((l) => l.token !== token))} openHref={(id) => `${HERE}?draft=${id}`} />
      </div>
      <p className="v5-finish-meta">
        <span data-deck-save={saveState}>{saveWords}</span>
        {permitHref ? <a href={permitHref} target="_blank" rel="noopener" data-deck-permit>Permit &amp; build set ↗</a> : null}
        {materialsHref("yard") ? <a href={materialsHref("yard")!} target="_blank" rel="noopener" data-deck-materials="yard">Material list ↗</a> : null}
      </p>
    </div>
  );

  const side = (
    <FieldScope.Provider value={rootScope}>
      <aside className="v5-side" aria-label="The deck's choices">
        <div className="v5-price" aria-live="polite">
          <div className="v5-price-main">
            <span className="v5-price-top">
              <span className="v5-price-label">{what} price</span>
              {priceStamp}
            </span>
            <span className="v5-price-v" data-v5-price>{money(pkg.subtotal)}</span>
            <span className="v5-price-sub">
              before tax · {money(pkg.pricePerSqFt, true)}{" a sq ft"} · {Math.round(pkg.areaSqFt)}{" sq ft"}
            </span>
          </div>
          {checkLine}
        </div>
        {checksPanel}
        {usual}
        {mores}
        {finish}
      </aside>
    </FieldScope.Provider>
  );

  /* ── under the editor: the price as the proposal carries it, the material package, the shop's prices ── */
  const below = (
    <div className="v5-below">
      <More title="Price lines" summary={`${pkg.lines.length} lines on the proposal · material ${money(pkg.materialSubtotal)} · labor ${money(pkg.laborSubtotal)}`} id="v5-lines">
        <div className="v5-table-wrap">
          <table className="v5-table">
            <thead>
              <tr>
                <th>On the proposal</th>
                <th className="v5-r">Qty</th>
                <th className="v5-r v5-hide-sm">Material</th>
                <th className="v5-r v5-hide-sm">Labor</th>
                <th className="v5-r">Total</th>
              </tr>
            </thead>
            <tbody>
              {pkg.lines.map((l) => (
                <tr key={l.id} data-line={l.id}>
                  <td>
                    <div className="v5-line-name">{l.name}{l.tbd ? <span className="v5-stamp v5-stamp--info">to be determined</span> : null}</div>
                    {l.description ? <div className="v5-line-desc">{l.description}</div> : null}
                  </td>
                  <td className="v5-r v5-nums">
                    {l.quantity.toLocaleString("en-US")} <span className="v5-unit">{l.unit}</span>
                  </td>
                  <td className="v5-r v5-nums v5-hide-sm">{money(l.materialCost, true)}</td>
                  <td className="v5-r v5-nums v5-hide-sm">{money(l.laborCost, true)}</td>
                  <td className="v5-r v5-nums v5-strong">{money(l.quantity * l.unitPrice, true)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Subtotal, before tax</td>
                <td />
                <td className="v5-hide-sm" />
                <td className="v5-hide-sm" />
                <td className="v5-r v5-nums v5-strong">{money(pkg.subtotal, true)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </More>

      <More title="Material package" summary={`${pkg.bom.length} lines · ${money(pkg.materialSubtotal)} · ${Math.round(pkg.takeoff.framingLf)} ft of framing · ${pkg.takeoff.footings} footings${pkg.takeoff.roofSquares ? ` · ${pkg.takeoff.roofSquares} squares of roof` : ""}`} id="v5-materials">
        <p className="v5-hint">What to load on the truck, in the lengths the yard sells. Lumber near the soil is ordered ground-contact. A fixture the client buys is listed, not priced.</p>
        <div className="v5-acts">
          {materialsHref("yard") ? <a className="v5-btn v5-btn--sm" href={materialsHref("yard")!} target="_blank" rel="noopener" data-deck-materials="yard">For the lumber yard ↗</a> : null}
          {materialsHref("installer") ? <a className="v5-btn v5-btn--sm" href={materialsHref("installer")!} target="_blank" rel="noopener" data-deck-materials="installer">For the installer to buy ↗</a> : null}
          {bomByStep.size ? (
            <button type="button" className="v5-btn v5-btn--sm v5-btn--quiet" onClick={() => setBomOpen((prev) => ([...bomByStep.keys()].every((k) => prev.has(k)) ? new Set() : new Set(bomByStep.keys())))} data-bom-all>
              {[...bomByStep.keys()].every((k) => bomOpen.has(k)) ? "Close all lines" : "Open all lines"}
            </button>
          ) : null}
          <span className="v5-mono">
            {pkg.takeoff.concreteBags} bags{pkg.takeoff.stairRisers ? ` · ${pkg.takeoff.stairRisers} risers` : ""}{pkg.takeoff.railLf ? ` · ${Math.round(pkg.takeoff.railLf)} ft of rail` : ""}
          </span>
        </div>
        <div className="v5-table-wrap">
          <table className="v5-table v5-bom">
            <thead>
              <tr>
                <th className="v5-r">Qty</th>
                <th>Item</th>
                <th className="v5-r v5-hide-sm">Each</th>
                <th className="v5-r">Cost</th>
              </tr>
            </thead>
            {[...bomByStep].map(([step, rows]) => (
              <tbody key={step} data-bom-step={step}>
                <tr className="v5-group-row">
                  <td colSpan={2}>
                    <button type="button" className="v5-group-toggle" aria-expanded={bomOpen.has(step)} onClick={() => toggleBom(step)} data-bom-toggle={step}>
                      <Chevron />
                      {BOM_STEP_LABEL[step]}
                      <span className="v5-group-count">{rows.length === 1 ? "1 line" : `${rows.length} lines`}</span>
                    </button>
                  </td>
                  <td className="v5-hide-sm" />
                  <td className="v5-r v5-nums v5-strong">{money(rows.reduce((a, l) => a + l.cost, 0), true)}</td>
                </tr>
                {rows.map((l) => (
                  <tr key={l.id} hidden={!bomOpen.has(step)}>
                    <td className="v5-r v5-nums">
                      {l.qty.toLocaleString("en-US")} <span className="v5-unit">{l.unit}</span>
                    </td>
                    <td>
                      <div className="v5-line-name">{l.label}{l.byClient ? <span className="v5-stamp v5-stamp--info">by the client</span> : null}</div>
                      {l.note ? <div className="v5-line-desc">{l.note}</div> : null}
                    </td>
                    <td className="v5-r v5-nums v5-hide-sm">
                      {l.byClient ? "—" : money(l.unitPrice, true)}
                      {l.source === "store" && !l.byClient ? <span className="v5-src" title={`${STORE_SURVEY.label} — set yours under Your prices`} data-price-source="store">{STORE_SURVEY.short}</span> : l.source !== "book" && !l.byClient ? <span className="v5-src" title="An example price — set yours under Your prices" data-price-source="example">ex</span> : null}
                    </td>
                    <td className="v5-r v5-nums">{l.byClient ? "TBD" : money(l.cost, true)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        {/* Anything no list carries (owner, 2026-10-12: "always an option custom"): on the material list and in the price as typed. */}
        <div className="v5-own" data-deck-own-items>
          <div className="v5-sub-title">Not on the list? Add your own{design.extras.items.length ? ` · ${design.extras.items.length} of ${CUSTOM_LIMITS.items}` : ""}</div>
          {design.extras.items.map((it) => (
            <div key={it.id} className="v5-own-row" data-deck-own={it.id}>
              <Field label="Item">
                <NameInput label="Item name" value={it.name} onCommit={(name) => setOwnItem(it.id, { name })} />
              </Field>
              <Field label="Qty">
                <NumberInput label={`${it.name}: quantity`} value={it.qty} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.qty.min} max={CUSTOM_LIMITS.qty.max} onCommit={(qty) => setOwnItem(it.id, { qty })} />
              </Field>
              <Field label="Unit">
                <select className="v5-sel" value={it.unit} onChange={(e) => setOwnItem(it.id, { unit: e.target.value as OwnUnit })} aria-label={`${it.name}: unit`}>
                  {OWN_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </Field>
              <Field label="Price" aside={`$ per ${it.unit}`}>
                <NumberInput label={`${it.name}: price per ${it.unit}`} value={it.price} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.price.min} max={CUSTOM_LIMITS.price.max} onCommit={(price) => setOwnItem(it.id, { price })} />
              </Field>
              <button type="button" className="v5-btn v5-btn--sm v5-btn--danger" onClick={() => setOwnItems((list) => list.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.name}`}>
                Remove
              </button>
            </div>
          ))}
          {design.extras.items.length < CUSTOM_LIMITS.items ? (
            <form
              className="v5-own-row"
              onSubmit={(e) => {
                e.preventDefault();
                addOwnItem();
              }}
              data-deck-own-new
            >
              <Field label="Item">
                <input className="v5-in" placeholder="A brand or a part no list carries" maxLength={CUSTOM_LIMITS.name} value={ownDraft.name} onChange={(e) => setOwnDraft((d) => ({ ...d, name: e.target.value }))} />
              </Field>
              <Field label="Qty">
                <input className="v5-in v5-num" inputMode="decimal" value={ownDraft.qty} onChange={(e) => setOwnDraft((d) => ({ ...d, qty: e.target.value }))} />
              </Field>
              <Field label="Unit">
                <select className="v5-sel" value={ownDraft.unit} onChange={(e) => setOwnDraft((d) => ({ ...d, unit: e.target.value as OwnUnit }))}>
                  {OWN_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </Field>
              <Field label="Price" aside={`$ per ${ownDraft.unit}`}>
                <input className="v5-in v5-num" inputMode="decimal" placeholder="0.00" value={ownDraft.price} onChange={(e) => setOwnDraft((d) => ({ ...d, price: e.target.value }))} />
              </Field>
              <button type="submit" className="v5-btn v5-btn--sm" disabled={!ownDraft.name.trim()}>
                + Add
              </button>
            </form>
          ) : null}
          <p className="v5-hint">Goes on the material list under Your own items and into the price as typed. Every list ends with Custom too — for a board, a roofing or a fixture the lists don&rsquo;t carry.</p>
        </div>
      </More>

      <More
        title="Your prices"
        summary={`Examples scaled to ${market.label} until you type your own${saving === "saved" && !unsaved ? " · saved" : saving === "failed" ? " · not saved" : unsaved ? " · unsaved changes" : ""}`}
        id="deck-rates"
        flag={unsaved ? <span className="v5-stamp v5-stamp--warn">Unsaved</span> : null}
      >
        <div className="v5-rates-head">
          <p className="v5-hint">Your number is charged as typed, on every deck from then on. Leave a row blank to go back to the example. The same book is on the <a href="/dashboard/deck-estimator/inventory" onClick={go("/dashboard/deck-estimator/inventory")}>deck inventory page</a>.</p>
          <button type="button" className="v5-btn v5-btn--sm" disabled={!unsaved || saving === "saving"} onClick={saveBook}>
            {saving === "saving" ? "Saving…" : "Save my prices"}
          </button>
        </div>
        <div className="v5-rates">
          {(Object.keys(DECK_RATE_GROUP_LABEL) as DeckRateGroup[]).map((group) => (
            <details key={group} className="v5-rate-group">
              <summary>
                {DECK_RATE_GROUP_LABEL[group]}
                <span className="v5-mono">{DECK_RATES.filter((rt) => rt.group === group && draftBook[rt.key] !== undefined).length || "no"} set</span>
                <Chevron />
              </summary>
              <div className="v5-rate-rows">
                {DECK_RATES.filter((rt) => rt.group === group).map((rt) => {
                  const example = deckRate(rt.key, undefined, market).price;
                  return (
                    <label key={rt.key} className="v5-rate-row">
                      <span className="v5-rate-label">{rt.label}</span>
                      <span className="v5-rate-unit">per {rt.unit}{rt.basis !== "labor" && storePrice(rt.key) ? ` · ${STORE_SURVEY.short} ${STORE_SURVEY.asOf.slice(0, 7)}` : ""}</span>
                      <input className="v5-in v5-num" inputMode="decimal" placeholder={example.toFixed(2)} value={drafts2[rt.key] ?? ""} onChange={(e) => setDrafts2((d) => ({ ...d, [rt.key]: e.target.value }))} />
                    </label>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </More>
    </div>
  );

  return (
    <div className="jf-deck-v5" data-nest data-v5-root data-stage={stage}>
      <header className="v5-head">
        <div className="v5-head-main">
          <h1 className="v5-title">Deck estimator</h1>
          {adminPreview ? (
            <p className="v5-preview">
              <span className="v5-stamp v5-stamp--warn">Coming soon</span>
              <span>Customers without the Deck Studio plan see its offer here. You can work in it because you are an admin.</span>
            </p>
          ) : null}
        </div>
        <div className="v5-head-side">
          {stage === "gallery" ? <span className="v5-save" data-deck-save={saveState}>{saveWords}</span> : null}
          {draftsMenu}
        </div>
      </header>

      {banners}

      {stage === "gallery" && priced ? (
        <DeckGallery
          priced={priced.list}
          blankPrice={priced.blank}
          appliedId={applied && applied.design === design ? applied.id : null}
          onPick={(sample) => {
            applySample(sample);
            toEditor();
          }}
          onBlank={() => {
            applyBlank();
            toEditor();
          }}
          addressField={addressField(false)}
          priceNote={
            <>
              {priceStamp}
              <span>Prices for {market.label}, on your rate book</span>
            </>
          }
          onBack={galleryFromEditor ? toEditor : null}
        />
      ) : (
        <div className="v5-editor">
          <div className="v5-bar">
            <button type="button" className="v5-btn v5-btn--sm v5-back" onClick={toGallery} data-v5-to-gallery>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
              All decks
            </button>
            <h2 className="v5-deck-name" title={deckName}>{deckName}</h2>
            <div className="v5-bar-addr">{addressField(true)}</div>
          </div>
          <div className="v5-panes">
            {stagePane}
            {side}
          </div>
          {below}
        </div>
      )}
    </div>
  );
}
