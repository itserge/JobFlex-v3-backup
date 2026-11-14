"use client";
// DECK ESTIMATOR — VARIANT 4: "THE PRICE IS THE POINT" (2026-10-18, one of five designs the owner compares).
//
// The contractor's real question is "what does this deck cost and what do I buy", so the page leads with the number:
// the total, the price a square foot and the material/labor split, with the actions beside it and the deck standing
// in 3D next to it. Under them, the code checks as the issues that keep the package from being clean, each with its
// fix. Then the working area: the material package grouped by part, every line with its quantity, unit and cost —
// beside it the design choices, each option showing what it does to the price ("Composite boards +$2,140").
//
// Same engine and the same functions as the live studio (deck-estimator-blueprint/deck-studio.tsx): the logic below
// is COPIED from deck-studio.tsx (its comments' intent kept), the layout is this variant's own. lib/deck is pure and
// runs here, so every change re-frames, re-counts and re-prices at once; the option prices are figured on a deferred
// copy of the design so typing never waits for them. The photo-of-the-house flow is dormant in the live studio
// (PHOTO_ENABLED = false since 2026-10-11) and is left out here; a reopened design keeps its photo untouched.

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
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
  STRUCTURES,
  WALL_FILL_LABEL,
  defaultDeckDesign,
  defaultFixture,
  defaultRoofDesign,
  defaultStair,
  hasDeck,
  hasRoof,
  sizeWords,
  structureWords,
  normalizeDeckDesign,
  SPA_LIMITS,
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
} from "@/lib/deck/design";
import { priceDeck, deckNotes, deckScope } from "@/lib/deck/pricing";
import { roofWords } from "@/lib/deck/roof";
import { railWords } from "@/lib/deck/rails";
import { electricalWords } from "@/lib/deck/electrical";
import { siteFromAddress, SLOPE_LIMITS, TERMITE_LABEL } from "@/lib/deck/site";
import { applyDeckPatch, checkSummary, deckChecks, type DeckCheck, type DeckPatch } from "@/lib/deck/checks";
import { deckScene, sceneBuildLayers, SCENE_LAYER_LABEL } from "@/lib/deck/scene";
import { BOM_STEP_LABEL, FIXTURE_RATE, type BomStep } from "@/lib/deck/takeoff";
import { STORE_SURVEY, storePrice } from "@/lib/deck/storePrices";
import { DECK_RATES, DECK_RATE_GROUP_LABEL, deckRate, sanitizeDeckRateBook, type DeckRateBook, type DeckRateGroup } from "@/lib/deck/rates";
import { convertDeckEstimateToProposal, updateDeckProposal, deleteDeckDraft, listDeckDrafts, loadDeckDraft, readDeckSite, saveDeckDraft, saveDeckRateBook, type DeckDraftRow, type ReturnedClientDesign } from "@/actions/deckEstimator";
import { deckClientInbox } from "@/actions/deckClientDesign";
import { jobLine, type ClientLinkRow } from "@/lib/deck/clientDesign";
import { HOUSE_LIMITS, HOUSE_ROOF_LABEL, HOUSE_ROOFS, QUICK_WALLS, QUICK_WALL_LABEL, ROOF_COLOURS, SIDINGS, deckShapeForHouse, houseForShape, houseNotes, houseWords, nextJogId, quickWall, quickWallOf, stepWords, wallWords, type HouseDesign, type HouseJog, type HouseRoof, wallHighlight, type WallFocus } from "@/lib/deck/house";
import { DECK_LOCK_WORDS, PROPOSAL_STATUS_WORDS, type LinkedDeckProposal } from "@/lib/deck/proposalEdit";
import { kindSample, samplesFor, type DeckSample } from "@/lib/deck/samples";
import { reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import { autoFixDesign, autoFixable, resizes, roofResizes, settleDesign } from "@/lib/deck/settle";
import type { DeckEdit, DeckPick, SceneHighlight } from "@/components/estimator/deck/DeckModel3D";
import { fieldLight, type FieldFocus } from "@/lib/deck/fieldParts";
import { HouseWallPlan } from "@/components/v3/deck-estimator-blueprint/house-wall-plan";
import { DeckPlan, type PlanEdgeHit, nearestStairEdge } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import { IsoFigure } from "@/components/v3/deck-estimator-blueprint/deck-kind-picker";
import { CUSTOM, CUSTOM_LABEL, CustomBox, Field, FieldScope, NameInput, NumberInput, PriceOptions, Scope, Seg, Toggle, ago, cx, delta, feetText, intText, money, parseFeet, parseInches, priceShow, priceText, type FieldScopeValue } from "./deck-v4-controls";
import { SendToClient } from "./deck-v4-send";
import "./deck-variant-4.css";

const DeckModel3D = dynamic(() => import("@/components/estimator/deck/DeckModel3D").then((m) => m.DeckModel3D), {
  ssr: false,
  loading: () => <div className="v4-fig-wait">Setting up the 3D view…</div>,
});

/** This variant's own address: drafts and client returns open here. */
const HERE = "/dashboard/deck-v4";

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
  { id: "good", name: "Good — treated wood", decking: (st) => treatedDecking(st), rail: "treated", words: "Treated boards and rail" },
  { id: "better", name: "Better — capped composite", decking: () => "composite-better", rail: "composite", words: "Composite boards and rail, no staining" },
  { id: "best", name: "Best — premium composite", decking: () => "composite-best", rail: "aluminum", words: "Premium boards, aluminum rail" },
];
/** Each choice section and the parts of the material package it buys. */
type SecId = "what" | "size" | "house" | "site" | "frame" | "deck" | "roof" | "rails" | "lights";
const SEC_STEPS: Partial<Record<SecId, BomStep[]>> = {
  frame: ["footings", "ledger", "framing", "drainage", "slab"],
  deck: ["decking", "fascia"],
  roof: ["roof-posts", "roof-frame", "roof-deck", "roofing", "trim", "ceiling", "gutters", "walls", "cupola"],
  rails: ["stairs", "rails"],
  lights: ["electrical"],
};
const STEP_SEC: Partial<Record<BomStep, SecId>> = Object.fromEntries(Object.entries(SEC_STEPS).flatMap(([sec, steps]) => (steps ?? []).map((st) => [st, sec as SecId])));

type Placing = null | { kind: "stair" } | { kind: "fixture"; id: string };

export interface OpenedDesign {
  design: DeckDesign;
  address: string | null;
  title: string;
  draftId: string | null;
  from: "draft" | "proposal";
  proposal?: LinkedDeckProposal | null;
  client?: ReturnedClientDesign | null;
}

/** Switching what is built: a different kind of roof starts from its own defaults; deck ↔ covered deck keeps the roof as set. */
function withStructure(d: DeckDesign, next: Structure): DeckDesign {
  const family = (st: Structure) => (st === "deck" || st === "covered-deck" ? "cover" : st);
  const roof = family(next) === family(d.structure) && d.structure !== "deck" ? d.roof : next === "covered-deck" && d.structure === "deck" && KINDS_FOR["covered-deck"].includes(d.roof.kind) ? d.roof : defaultRoofDesign(next);
  return applyDeckPatch(d, { structure: next, roof, floor: next === "deck" || next === "covered-deck" ? "deck" : d.floor });
}

/* ------------------------------------------------------------------ */
/*  Priced choices: each one figures what its options do to the price  */
/* ------------------------------------------------------------------ */

interface PriceCtx {
  base: DeckDesign;
  basePrice: number;
  rates: DeckRateBook;
  market: MarketSnapshot;
}
type Apply = (d: DeckDesign) => DeckDesign;
const priceOf = (ctx: PriceCtx, d: DeckDesign) => priceDeck(d, { rates: ctx.rates, market: ctx.market }).subtotal;

/** Radio cards; each its own component so the deferred render can pause between them. */
function Priced<T extends string | number>({ ctx, label, value, options, onPick, cols, totals }: { ctx: PriceCtx; label: string; value: T | null; options: ReadonlyArray<{ value: T; name: string; sub?: string; apply: Apply; disabled?: boolean; title?: string }>; onPick: (v: T) => void; cols?: 1 | 2 | 3; totals?: boolean }) {
  const sig = options.map((o) => `${o.value}:${o.disabled ? 1 : 0}`).join("|");
  const prices = React.useMemo(
    () => options.map((o) => (o.disabled ? null : priceOf(ctx, o.apply(ctx.base)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `options` is rebuilt every render; what it prices follows `ctx` and its values.
    [ctx, sig],
  );
  return (
    <PriceOptions
      label={label}
      value={value}
      cols={cols}
      onPick={onPick}
      options={options.map((o, i) => ({
        value: o.value,
        name: o.name,
        sub: totals && prices[i] !== null ? [o.sub, money(prices[i] as number)].filter(Boolean).join(" · ") : o.sub,
        change: prices[i] === null ? null : (prices[i] as number) - ctx.basePrice,
        disabled: o.disabled,
        title: o.title,
      }))}
    />
  );
}

/** A tick that says what flipping it does to the price. */
function PToggle({ ctx, checked, onChange, flip, children }: { ctx: PriceCtx; checked: boolean; onChange: (v: boolean) => void; flip: Apply; children: React.ReactNode }) {
  const change = React.useMemo(
    () => priceOf(ctx, flip(ctx.base)) - ctx.basePrice,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `flip` is rebuilt every render; the tick's state is what changes it.
    [ctx, checked],
  );
  return (
    <Toggle checked={checked} onChange={onChange} price={Math.abs(Math.round(change)) >= 1 ? delta(change) : null}>
      {children}
    </Toggle>
  );
}

/** Buttons that add a part, each with what the part adds to the price. */
function AddPriced({ ctx, label, items }: { ctx: PriceCtx; label: string; items: ReadonlyArray<{ key: string; name: string; apply: Apply; onAdd: () => void; disabled?: boolean; data?: Record<string, string> }> }) {
  const sig = items.map((i) => `${i.key}:${i.disabled ? 1 : 0}`).join("|");
  const prices = React.useMemo(
    () => items.map((i) => (i.disabled ? null : priceOf(ctx, i.apply(ctx.base)) - ctx.basePrice)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `items` is rebuilt every render; what they price follows `ctx`.
    [ctx, sig],
  );
  return (
    <div className="v4-adds" role="group" aria-label={label}>
      {items.map((it, i) => (
        <button key={it.key} type="button" className="v4-add" disabled={it.disabled} onClick={it.onAdd} {...(it.data ?? {})}>
          <span className="v4-add-name">+ {it.name}</span>
          <span className="v4-add-price">{prices[i] === null ? "" : delta(prices[i] as number)}</span>
        </button>
      ))}
    </div>
  );
}

/** One part of the design: its name, what it is now and what it buys; opened to change it. */
function Section({ id, title, summary, cost, open, onToggle, step, children }: { id: SecId; title: string; summary: string; cost?: number; open: boolean; onToggle: () => void; step: string; children: React.ReactNode }) {
  return (
    <section className={cx("v4-sec", open && "is-open")} id={`v4-sec-${id}`} data-v4-sec={id}>
      <h3 className="v4-sec-h">
        <button type="button" className="v4-sec-btn" aria-expanded={open} aria-controls={`v4-sec-${id}-body`} onClick={onToggle}>
          <span className="v4-sec-title">{title}</span>
          {cost ? <span className="v4-sec-cost">{money(cost)}</span> : null}
          <span className="v4-sec-sum">{summary}</span>
          <span className="v4-sec-chev" aria-hidden="true" />
        </button>
      </h3>
      {open ? (
        <div className="v4-sec-body" id={`v4-sec-${id}-body`}>
          <Scope step={step}>{children}</Scope>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  The studio                                                         */
/* ------------------------------------------------------------------ */

export function DeckStudioV4({ initialBook, homeState, initialAddress, clientId, adminPreview = false, opened = null }: { initialBook: DeckRateBook; homeState: string | null; initialAddress?: string; clientId?: string; adminPreview?: boolean; opened?: OpenedDesign | null }) {
  const router = useRouter();
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

  // SETTLING: a size change re-runs the tables (lib/deck/settle) and applies the member-sizing fixes the checks would
  // offer, so what stands on screen is never a frame the tables refuse. The fixes' labels show until the next resize.
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
        // THE HOUSE AND THE DECK AGREE (lib/deck/house).
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
  const setOwnItems = React.useCallback((fn: (list: OwnItem[]) => OwnItem[]) => {
    dirty.current = true;
    setDesign((d) => applyDeckPatch(d, { extras: { items: fn(d.extras.items) } }));
  }, []);
  const [ownDraft, setOwnDraft] = React.useState<{ name: string; qty: string; unit: OwnUnit; price: string }>({ name: "", qty: "1", unit: "ea", price: "" });
  const [freshCustom, setFreshCustom] = React.useState<string | null>(null);

  /* ── the layout's own state ── */
  const topRef = React.useRef<HTMLElement>(null);
  const figRef = React.useRef<HTMLElement>(null);
  const [tab, setTab] = React.useState<"package" | "proposal" | "prices">("package");
  /** The package's groups folded shut (they start open: the package is the page's working area). */
  const [bomShut, setBomShut] = React.useState<ReadonlySet<BomStep>>(() => new Set());
  const [openSecs, setOpenSecs] = React.useState<ReadonlySet<SecId>>(() => new Set<SecId>(["what", "size", "deck", "rails"]));
  const toggleSec = (id: SecId) =>
    setOpenSecs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const goSec = (id: SecId) => {
    setOpenSecs((prev) => new Set(prev).add(id));
    requestAnimationFrame(() => {
      const el = document.getElementById(`v4-sec-${id}`);
      if (!el) return;
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
      el.querySelector("button")?.focus({ preventScroll: true });
    });
  };
  const showFigure = () => {
    const el = figRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    }
  };
  // THE PRICE RIDES ALONG: once the price header scrolls away, the total, the checks and the proposal button stay at the foot.
  const [topOut, setTopOut] = React.useState(false);
  React.useEffect(() => {
    const el = topRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setTopOut(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
    if (!touched.current.has("railHeight")) p.rail = { heightIn: st.code.guardIn };
    dirty.current = true;
    setDesign((d) => applyDeckPatch(d, { ...p, site: { ...d.site, groundSnowPsf: st.groundSnowPsf, termite: st.termite, state: st.state || null } }));
  };

  const setStructure = (next: Structure) => {
    dirty.current = true;
    setDesign((d) => withStructure(d, next));
  };
  // A SAMPLE TO START FROM (lib/deck/samples): laid over the contractor's own address, site, house and lumber, settled
  // to the tables like any resize. Marked "In use" exactly as long as the design is the one the sample made.
  const [applied, setApplied] = React.useState<{ id: string; design: DeckDesign } | null>(null);
  const sampleDesignOver = (d: DeckDesign, sample: DeckSample, settleIt: (x: DeckDesign) => DeckDesign) => {
    let next = applyDeckPatch(d, sample.patch);
    const h2 = houseForShape(next.house, next.shape);
    if (h2 !== next.house) next = applyDeckPatch(next, { house: h2 });
    return settleIt(next);
  };
  const applySample = (sample: DeckSample) => {
    dirty.current = true;
    const next = sampleDesignOver(design, sample, settle);
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

  // THE OPTION PRICES: figured on a deferred copy of the design, so a keystroke never waits on them.
  const deferred = React.useDeferredValue(design);
  const ctx = React.useMemo<PriceCtx>(
    () => ({ base: deferred, basePrice: deferred === design ? pkg.subtotal : priceDeck(deferred, { rates: book, market }).subtotal, rates: book, market }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the base is the deferred design; the urgent one only saves a second pricing.
    [deferred, book, market],
  );

  // THE FIELD, SHOWN IN 3D: the field being typed in — or the one the pointer is over — lights its part.
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
  // WORKING IN THE SHAPE IS QUIET: the drawing of the wall lights nothing, and a press in it puts out every light.
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
  const r = design.roof;
  const polygon = r.plan.shape === "hexagon" || r.plan.shape === "octagon" || r.plan.shape === "round";

  /* ── the 3D's build-up, night, connections, picking ── */
  const [view, setView] = React.useState<"3d" | "plan" | "wall">("3d");
  const openWallLarge = React.useCallback(() => {
    setView("wall");
    requestAnimationFrame(() => figRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [setView]);
  const buildLayers = React.useMemo(() => sceneBuildLayers(scene), [scene]);
  const LAYERS = buildLayers.length;
  const [built, setBuilt] = React.useState<number>(Number.POSITIVE_INFINITY);
  const [xray, setXray] = React.useState(false);
  const [night, setNight] = React.useState(false);
  const [connections, setConnections] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [resetToken, setResetToken] = React.useState(0);
  const [hoverPick, setHoverPick] = React.useState<DeckPick | null>(null);
  const [picked, setPicked] = React.useState<{ legend: NonNullable<DeckPick["legend"]>; point: [number, number, number] } | null>(null);
  const [focus, setFocus] = React.useState<[number, number, number] | null>(null);
  const [placing, setPlacing] = React.useState<Placing>(null);
  const [editing, setEditing] = React.useState(false);
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

  const onPick = React.useCallback(
    (pick: DeckPick | null, kind: "hover" | "click") => {
      if (kind === "hover") {
        setHoverPick(pick);
        return;
      }
      if (placing?.kind === "stair") {
        // A click anywhere on the deck takes its nearest open edge.
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
    [placing, setFixtures, setStairs, setPlacing, structure],
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
  /** "Save draft" now: the auto-save runs at once instead of a moment after the last change. */
  const [saveTick, setSaveTick] = React.useState(0);
  const lastTick = React.useRef(0);
  // THE PROPOSAL IT WAS OPENED FROM: "Update" re-prices that one (actions/deckEstimator updateDeckProposal).
  const [linked, setLinked] = React.useState<LinkedDeckProposal | null>(opened?.proposal ?? null);
  const linkedId = linked?.id ?? null;
  const designSig = React.useMemo(() => JSON.stringify([design, address]), [design, address]);
  const [proposalSig, setProposalSig] = React.useState<string | null>(() => (opened?.from === "proposal" ? designSig : null));
  const [updated, setUpdated] = React.useState<{ at: string; kept: number; titleKept: boolean; scopeKept: boolean } | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const behind = !!linked && designSig !== proposalSig;
  // THE CLIENT'S RETURN: the design on screen may be one a client sent back, and the studio asks every half minute
  // for returns nobody has opened yet — those bloom at the top until opened or put aside.
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
  React.useEffect(() => {
    if (!dirty.current) return;
    const now = saveTick !== lastTick.current;
    lastTick.current = saveTick;
    const t = setTimeout(
      async () => {
        setSaveState("saving");
        try {
          localStorage.setItem("jf-deck-draft", JSON.stringify({ design, address, at: Date.now() }));
        } catch {
          /* the server copy is the one that counts */
        }
        // A dropped connection is a failed save, said under the actions — not an error thrown at the page.
        const res = await saveDeckDraft({ id: draftId, title: draftTitle || null, design, address, proposalId: linkedId, clientToken }).catch(() => ({ ok: false as const, error: "" }));
        if (res.ok) {
          setDraftId(res.id);
          setSavedAt(res.updatedAt);
          setSaveState("saved");
        } else setSaveState("failed");
      },
      now ? 0 : 1500,
    );
    return () => clearTimeout(t);
  }, [design, address, draftId, draftTitle, linkedId, clientToken, saveTick]);
  const saveNow = () => {
    dirty.current = true;
    setSaveTick((n) => n + 1);
  };
  const refreshDrafts = async () => {
    const res = await listDeckDrafts();
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
  // THE MATERIAL LIST: the takeoff for the lumber yard's quote or the installer's purchase, on its own page.
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
  const structureSummary = `${what}${withRoof && design.structure !== "covered-deck" ? ` · ${FLOOR_LABEL[design.floor].toLowerCase()}` : ""}`;
  const shapeSummary = `${sizeWords(design)} · ${Math.round(pkg.areaSqFt)} sq ft`;
  const heightSummary = withDeck ? `${design.heightIn >= 24 ? ftIn(design.heightIn) : `${design.heightIn} in.`} · ${design.placement === "attached" ? "ledger" : design.placement === "beside" ? "own posts" : "free-standing"}${structure.gradePct >= 2 ? ` · ${structure.gradePct}% fall` : ""}` : `${design.loadPsf} psf · ${design.soilPsf.toLocaleString("en-US")} psf soil · frost ${design.frostIn} in.`;
  const frameSummary = frame ? `${frame.joistSize} @ ${frame.spacingIn}" · ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")} ${frame.beamStyle === "flush" ? "flush" : "beam"} · ${design.footing.type === "poured" ? "poured footings" : "pier blocks"}` : "";
  const surfaceSummary = frame ? `${design.custom.decking?.name ?? frame.decking.label}${design.decking.pattern !== "straight" ? ` · ${design.decking.pattern}` : ""}${design.decking.border ? " · border" : ""}` : "";
  const roofSummary = roof ? roofWords(roof) : "";
  const extrasSummary = [structure.rails.on ? railWords(structure.rails).split(" — ")[0] : "No railing", structure.stairs.length ? `${structure.stairs.length} ${structure.stairs.length === 1 ? "stair" : "stairs"}` : "no stairs"].join(" · ");
  const electricSummary = structure.electrical.on ? electricalWords(structure.electrical) : "None yet";

  const bomByStep = React.useMemo(() => {
    const out = new Map<BomStep, typeof pkg.bom>();
    for (const l of pkg.bom) out.set(l.step, [...(out.get(l.step) ?? []), l]);
    return out;
  }, [pkg]);
  const secCost = (id: SecId) => (SEC_STEPS[id] ?? []).reduce((a, st) => a + (bomByStep.get(st) ?? []).reduce((b, l) => b + l.cost, 0), 0);

  // ── PRODUCTS OF THE SHOP'S OWN: every material list ends with Custom; the list's choice stays as what it is built
  // like, and the typed name and price stand in for it on the material list and the proposal.
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
  // THE BOARD LIST: the boards most used in the job's region first, then the woods, the brands' own lines, and the
  // generic composite, PVC, mineral-based and aluminum boards. Custom closes it.
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
  const loudOnes = ordered.filter(loud);
  const quietOnes = ordered.filter((c) => !loud(c));
  const checkRow = (c: DeckCheck) => (
    <li key={c.id} className={cx("v4-issue", `v4-issue--${c.level}`)} data-check={c.id}>
      <span className={cx("v4-stamp", c.level === "fail" ? "v4-stamp--bad" : c.level === "warn" ? "v4-stamp--warn" : c.level === "pass" ? "v4-stamp--pass" : "v4-stamp--info")}>{LEVEL_LABEL[c.level]}</span>
      <div className="v4-issue-text">
        <p>
          <b>{c.part}.</b> {c.text}
        </p>
        {c.rule ? <p className="v4-issue-rule">{c.rule}</p> : null}
      </div>
      {c.fix || c.alts?.length ? (
        <div className="v4-issue-fixes">
          {c.fix ? (
            <button type="button" className="v4-btn v4-btn--sm" onClick={() => patch(c.fix!.patch)} data-check-fix="primary">
              {c.fix.label}
            </button>
          ) : null}
          {(c.alts ?? []).map((a) => (
            <button key={a.label} type="button" className="v4-btn v4-btn--sm v4-btn--quiet" onClick={() => patch(a.patch)} data-check-fix="alt">
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
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
  const tierState = market.state || homeState;
  const railFor = (t: (typeof TIERS)[number]) => (design.rail.type === "none" && !structure.rails.required ? "none" : t.rail);
  const tierNow = TIERS.find((t) => !design.custom.decking && design.decking.product === t.decking(tierState) && design.rail.type === railFor(t))?.id ?? null;
  const matPct = pkg.subtotal > 0 ? Math.round((pkg.materialSubtotal / pkg.subtotal) * 100) : 0;
  const clean = !summary.fail && !summary.warn;
  const verdict = summary.fail ? `${summary.fail} ${summary.fail === 1 ? "issue blocks" : "issues block"} a clean package` : summary.warn ? `${summary.warn} to check before it goes out` : "Clean package — every part inside its table";

  // The roof's outline and size — in the Roof part over a deck; the Footprint for a gazebo or pergola on its own floor.
  const outlineBlock = (
    <>
      <Field label="Outline" wide>
        <Seg label="Roof outline" value={r.plan.shape} onChange={(sh: RoofPlanShape) => rp({ plan: { ...r.plan, shape: sh } })} options={planShapes.map((sh) => ({ value: sh, label: ROOF_PLAN_LABEL[sh] }))} />
      </Field>
      {r.plan.shape !== "follows-deck" ? (
        <div className="v4-grid2">
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
        <p className="v4-hint">
          {Math.round(roof.footprintSqFt)} sq ft under the eaves · {roof.posts.length} posts{roof.attach === "wall" ? " and the house wall" : ""}
          {roof.kind !== "pergola" ? ` · ${Math.round(roof.roofAreaSqFt)} sq ft of roof, ${roof.squares} squares` : ""}
          {roof.engineered ? " · engineered beam where the sawn tables stop" : ""}
        </p>
      ) : null}
    </>
  );

  const confirmBox = linked && confirming ? (
    <div className="v4-call v4-call--warn v4-confirm" role="alertdialog" aria-label="Update a proposal the client has" data-deck-update-confirm>
      <p>
        <b>The client already has this proposal{linked.status === "VIEWED" ? " and has opened it" : ""}.</b> Updating it changes the price and the 3D on their link.
      </p>
      <div className="v4-acts">
        <button type="button" className="v4-btn v4-btn--sm v4-btn--primary" onClick={() => void update()} data-deck-update-yes>
          Update it
        </button>
        <button type="button" className="v4-btn v4-btn--sm" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  ) : null;

  /** The one blue action of the page: make the proposal, or bring the one it is on up to date. */
  const primaryAction =
    linked && !linked.lock ? (
      <button type="button" className="v4-btn v4-btn--primary v4-btn--big" disabled={!!busy || !behind} onClick={askUpdate} data-deck-update="head">
        {busy === "update" ? "Updating…" : !behind ? `${linked.ref} is up to date` : summary.fail ? `Update ${linked.ref} anyway` : `Update ${linked.ref}`}
      </button>
    ) : (
      <button type="button" className="v4-btn v4-btn--primary v4-btn--big" disabled={!!busy} onClick={convert} data-deck-convert>
        {busy === "convert" ? "Making the proposal…" : summary.fail ? "Make proposal anyway" : "Make proposal"}
      </button>
    );

  return (
    <div className="jf-deck-v4" data-nest>
      {/* ── notices: a client's return, the client's own words, the proposal this design is on ── */}
      {inboxNew.length ? (
        <section className="v4-notice v4-notice--inbox" aria-live="polite" aria-label="Designs sent back by clients" data-deck-inbox={inboxNew.length}>
          {inboxNew.slice(0, 3).map((l) => (
            <div key={l.token} className="v4-notice-row" data-deck-inbox-row={l.token}>
              <span className="v4-stamp v4-stamp--info">Sent back</span>
              <div className="v4-notice-text">
                <b>{l.clientName}</b> sent back a deck design{l.sentAt ? ` · ${ago(l.sentAt)}` : ""} <span className="v4-notice-quiet">for {jobLine(l)}</span>
                {l.words && (l.proposal || l.words !== l.title) ? <span className="v4-notice-quiet"> · {l.words}</span> : null}
                {l.note ? <span className="v4-notice-note">“{l.note.length > 120 ? `${l.note.slice(0, 120)}…` : l.note}”</span> : null}
              </div>
              <div className="v4-acts">
                {l.draftId ? (
                  <Link className="v4-btn v4-btn--sm" href={`${HERE}?draft=${l.draftId}` as Route} data-deck-inbox-open>
                    Open it
                  </Link>
                ) : null}
                <button type="button" className="v4-btn v4-btn--sm v4-btn--quiet" onClick={() => putAside(l)} aria-label={`Put ${l.clientName}'s design aside until they send again`}>
                  Later
                </button>
              </div>
            </div>
          ))}
          {inboxNew.length > 3 ? <p className="v4-hint">and {inboxNew.length - 3} more under Send to client</p> : null}
        </section>
      ) : null}

      {fromClient ? (
        <section className="v4-notice" aria-label="What the client sent" data-deck-from-client>
          <div className="v4-notice-text">
            <b>{fromClient.name}&apos;s design</b>
            <span className="v4-notice-quiet">
              {fromClient.sends > 1 ? ` · sent ${fromClient.sends} times` : ""}
              {fromClient.sentAt ? ` · ${ago(fromClient.sentAt)}` : ""}
              {!linked ? ` · ${fromClient.title}${fromClient.address ? `, ${fromClient.address}` : ""}` : ""}
            </span>
            <span className="v4-notice-note">
              {fromClient.note ? <>“{fromClient.note}” </> : <>No note with it. </>}
              {fromClient.unsure.includes("height") ? <b>Not sure of the height — measure it on site. </b> : null}
              {linked ? "Price it, then update the proposal." : "Price it, then make the proposal — the client's link follows it."}
            </span>
          </div>
          <div className="v4-acts">
            {fromClient.phone ? <a className="v4-btn v4-btn--sm" href={`tel:${fromClient.phone}`}>Call {fromClient.name.split(/\s+/)[0]}</a> : null}
            <a className="v4-btn v4-btn--sm v4-btn--quiet" href={fromClient.url} target="_blank" rel="noopener">Their page ↗</a>
          </div>
        </section>
      ) : null}

      {linked ? (
        <section className="v4-notice" aria-label="The proposal this design is on" data-deck-linked={linked.lock ? "locked" : behind ? "behind" : "even"}>
          <div className="v4-notice-text">
            <b>
              Pricing the deck of {linked.ref} · {linked.title}
            </b>{" "}
            <span className={cx("v4-stamp", linked.lock ? "v4-stamp--warn" : linked.seen ? "v4-stamp--info" : "v4-stamp--pass")} data-deck-linked-status>
              {PROPOSAL_STATUS_WORDS[linked.status] ?? linked.status}
            </span>
            <span className="v4-notice-note">
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
          <div className="v4-acts">
            <Link className="v4-btn v4-btn--sm" href={`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}` as Route} data-deck-linked-back>
              Back to the proposal
            </Link>
          </div>
        </section>
      ) : null}

      {/* ── THE PRICE, THE ACTIONS AND THE DECK ── */}
      <section className="v4-top" ref={topRef} aria-label="Price">
        <div className="v4-price">
          <div className="v4-headline">
            <h1 className="v4-h1">Deck estimate</h1>
            {adminPreview ? (
              <span className="v4-stamp v4-stamp--warn" title="Customers without the Deck Studio plan see its offer here. You can work and test it because you are an admin.">
                Coming soon · admin
              </span>
            ) : null}
          </div>
          <p className="v4-jobtitle">{draftTitle.trim() || title}</p>
          <form
            className="v4-addr"
            onSubmit={(e) => {
              e.preventDefault();
              commitAddress(addressDraft);
            }}
          >
            <Field label="Job address" aside={`${site.label} · frost ${design.frostIn} in. · snow ${design.site.groundSnowPsf} psf`} wide lights={null}>
              <input className="v4-in" value={addressDraft} placeholder="Street, city, state ZIP" autoComplete="street-address" onChange={(e) => setAddressDraft(e.target.value)} onBlur={() => addressDraft.trim() !== address && commitAddress(addressDraft)} />
            </Field>
          </form>

          <div className="v4-total" data-v4-total>
            <span className="v4-total-v" aria-live="polite">{money(pkg.subtotal)}</span>
            <span className="v4-total-h">before tax</span>
          </div>
          <div className="v4-figures">
            <div className="v4-figure-cell">
              <span className="v4-k">Per sq ft</span>
              <span className="v4-v">{money(pkg.pricePerSqFt, true)}</span>
              <span className="v4-h">{Math.round(pkg.areaSqFt)} sq ft{withDeck ? " of deck" : " of floor"}</span>
            </div>
            <div className="v4-figure-cell">
              <span className="v4-k">
                <i className="v4-key v4-key--mat" aria-hidden="true" />
                Material
              </span>
              <span className="v4-v">{money(pkg.materialSubtotal)}</span>
              <span className="v4-h">{pkg.bom.length} lines in the package</span>
            </div>
            <div className="v4-figure-cell">
              <span className="v4-k">
                <i className="v4-key v4-key--lab" aria-hidden="true" />
                Labor
              </span>
              <span className="v4-v">{money(pkg.laborSubtotal)}</span>
              <span className="v4-h">by the measure</span>
            </div>
          </div>
          <div className="v4-split" role="img" aria-label={`Material ${matPct}%, labor ${100 - matPct}% of the price`}>
            <i style={{ width: `${matPct}%` }} />
          </div>

          <div className="v4-stamps">
            <a className={cx("v4-stamp", summary.fail ? "v4-stamp--bad" : summary.warn ? "v4-stamp--warn" : "v4-stamp--pass")} href="#v4-issues" data-v4-verdict>
              {verdict}
            </a>
            {exampleShare > 0 ? (
              <button type="button" className="v4-stamp v4-stamp--warn v4-stamp--btn" onClick={() => { setTab("prices"); document.getElementById("v4-pkg")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} title="Set your own under Your prices before it goes to a client">
                {exampleShare}% example prices
              </button>
            ) : (
              <span className="v4-stamp v4-stamp--pass">Your prices</span>
            )}
            {pkg.storeShare > 0 ? (
              <span className="v4-stamp v4-stamp--plain" title={`Materials at ${STORE_SURVEY.store}'s listed prices, surveyed once (${STORE_SURVEY.asOf}) — your own prices win`} data-deck-store-share>
                Materials: {STORE_SURVEY.store}, {new Date(STORE_SURVEY.asOf + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
            ) : null}
          </div>

          <div className="v4-actions">
            {primaryAction}
            {linked && !linked.lock ? (
              <button type="button" className="v4-btn" disabled={!!busy} onClick={convert} data-deck-convert-new>
                {busy === "convert" ? "Making the proposal…" : "Save as a new proposal"}
              </button>
            ) : null}
            <button type="button" className="v4-btn" onClick={saveNow} disabled={saveState === "saving"} data-v4-save>
              {saveState === "saving" ? "Saving…" : "Save draft"}
            </button>
            <SendToClient design={design} address={address} title={draftTitle.trim()} clientId={clientId} proposalId={linkedId} unseen={inbox.length} onOpened={(token) => setInbox((list) => list.filter((l) => l.token !== token))} openHref={(id) => `${HERE}?draft=${id}`} />
            <details className="v4-pop" data-v4-export>
              <summary className="v4-btn">Export package</summary>
              <div className="v4-pop-body">
                <div className="v4-pop-title">Take the package out</div>
                <div className="v4-pop-links">
                  {materialsHref("yard") ? (
                    <a className="v4-pop-link" href={materialsHref("yard")! as Route} target="_blank" rel="noopener" data-deck-materials="yard">
                      <b>Material list for the lumber yard ↗</b>
                      <span>Every line in the lengths the yard sells, for their quote</span>
                    </a>
                  ) : null}
                  {materialsHref("installer") ? (
                    <a className="v4-pop-link" href={materialsHref("installer")! as Route} target="_blank" rel="noopener" data-deck-materials="installer">
                      <b>For the installer to buy ↗</b>
                      <span>The same list, worded for the crew picking it up</span>
                    </a>
                  ) : null}
                  {permitHref ? (
                    <a className="v4-pop-link" href={permitHref as Route} target="_blank" rel="noopener" data-deck-permit>
                      <b>Permit &amp; build set ↗</b>
                      <span>The framing plan and the code tables it is sized from</span>
                    </a>
                  ) : null}
                </div>
              </div>
            </details>
            <details className="v4-pop" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void refreshDrafts()} data-deck-drafts>
              <summary className="v4-btn v4-btn--quiet">Drafts</summary>
              <div className="v4-pop-body v4-pop-body--wide">
                <div className="v4-pop-title">This draft</div>
                <div className="v4-draft-new">
                  <input className="v4-in" value={draftTitle} placeholder={structureWords(design)} aria-label="Name this draft" onChange={(e) => { dirty.current = true; setDraftTitle(e.target.value); }} />
                  <button type="button" className="v4-btn v4-btn--sm" onClick={startFresh}>
                    New deck
                  </button>
                </div>
                <div className="v4-pop-title v4-pop-title--rule">Saved drafts</div>
                {drafts === null ? <div className="v4-empty">Reading…</div> : drafts.length === 0 ? <div className="v4-empty">No saved drafts yet. The one you are working on appears here a moment after your first change.</div> : null}
                <div className="v4-rows">
                  {(drafts ?? []).map((d) => (
                    <div key={d.id} className="v4-draft" data-deck-draft={d.id}>
                      <div className="v4-draft-text">
                        <div className="v4-draft-name">
                          {d.title}
                          {d.id === draftId ? " · open" : ""}
                        </div>
                        <div className="v4-draft-meta">
                          {ago(d.updatedAt)}
                          {d.fromClient ? ` · from ${d.fromClient}` : ""}
                          {d.proposalId ? " · changes to a saved proposal" : ""}
                          {d.address ? ` · ${d.address}` : ""}
                          {d.by && !d.fromClient ? ` · ${d.by}` : ""}
                        </div>
                      </div>
                      <button type="button" className="v4-btn v4-btn--sm" onClick={() => void openDraft(d.id)} disabled={d.id === draftId}>
                        Open
                      </button>
                      <button type="button" className="v4-btn v4-btn--sm v4-btn--danger" onClick={() => void removeDraft(d.id)} aria-label={`Delete the draft ${d.title}`}>
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </div>
          <p className="v4-save" data-deck-save={saveState}>
            {saveState === "saving" ? "Saving…" : saveState === "saved" && savedAt ? `${linked ? "Draft saved" : "Saved"} ${ago(savedAt)}` : saveState === "failed" ? "Not saved — will retry on the next change" : linked ? `Opened from ${linked.ref}` : "Saves itself as you go"}
          </p>
          {confirmBox}
          {error ? (
            <p className="v4-call v4-call--bad" role="alert">
              {error}
            </p>
          ) : null}
          {linked && updated && !behind ? (
            <p className="v4-call v4-call--pass" role="status" data-deck-updated>
              <b>
                {linked.ref} updated {ago(updated.at)}.
              </b>{" "}
              {updatedWords}{" "}
              <Link href={`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}` as Route}>Open the proposal</Link>
            </p>
          ) : null}
        </div>

        {/* ── the deck, turnable ── */}
        <figure className="v4-fig" ref={figRef} aria-label={`The ${what.toLowerCase()}`} data-deck-viewer>
          <div className="v4-fig-head">
            <Seg label="View" value={view} onChange={setView} options={[{ value: "3d" as const, label: "3D" }, { value: "plan" as const, label: "Framing plan" }, { value: "wall" as const, label: "House & deck" }]} />
            <span className="v4-fig-facts">{scene.facts}</span>
          </div>
          <div className={cx("v4-fig-box", view === "wall" && "v4-fig-box--wall")}>
            {view === "wall" ? (
              <div className="v4-fig-plan v4-fig-plan--wall" onPointerDownCapture={quiet} data-deck-wall-large-view>
                <HouseWallPlan size="large" shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} />
              </div>
            ) : view === "3d" ? (
              <>
                <DeckModel3D scene={scene} built={built} xray={xray} backdrop={null} night={night} connections={connections} placing={placing?.kind === "fixture" || placing?.kind === "stair"} edit={editing} onEdit={onEdit} resetToken={resetToken} focus={focus} onPick={onPick} highlight={wallLit ?? fieldLit} className="v4-canvas" label={`The ${what.toLowerCase()} in 3D: ${scene.facts}`} />
                {editing && !placing ? (
                  <div className="v4-banner" data-deck-editing>
                    <span>Drag the blue knobs — width, depth, height, the roof and its pitch, the lower level, each stair, the house&apos;s corners and steps. The price follows.</span>
                    <button type="button" className="v4-btn v4-btn--sm" onClick={() => setEditing(false)}>
                      Done
                    </button>
                  </div>
                ) : null}
                {hoverPick?.legend && !placing ? (
                  <div className="v4-tag" data-deck-hover>
                    <b>
                      {hoverPick.legend.role}
                      {hoverPick.legend.nominal ? ` · ${hoverPick.legend.nominal}` : ""}
                      {hoverPick.legend.lengthFt ? ` · ${ftIn(hoverPick.legend.lengthFt * 12)}` : ""}
                    </b>
                    {hoverPick.legend.note.split(/(?<=\.)\s/)[0]} {hoverPick.layer !== null ? <span className="v4-mono">click to zoom</span> : null}
                  </div>
                ) : null}
                {placing?.kind === "stair" ? (
                  <div className="v4-banner" data-deck-placing="stair-3d">
                    <span>Click the deck where the stairs go — they take the nearest open edge, on whichever level you click.</span>
                    <button type="button" className="v4-btn v4-btn--sm" onClick={() => setPlacing(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
                {placingFixture ? (
                  <div className="v4-banner" data-deck-placing="fixture">
                    <span>Click on the {what.toLowerCase()} where the {FIXTURE_SHORT[placingFixture.kind].toLowerCase()} goes — a post, a header, the rail, the ceiling, the house wall.</span>
                    <button type="button" className="v4-btn v4-btn--sm" onClick={() => setPlacing(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="v4-fig-plan">
                <DeckPlan structure={structure} placing={placing?.kind === "stair" ? "stair" : null} onPlaceStair={placeStair} />
                {placing?.kind === "stair" ? (
                  <div className="v4-banner" data-deck-placing="stair">
                    <span>Click an open edge of the deck where the stairs go.</span>
                    <button type="button" className="v4-btn v4-btn--sm" onClick={() => setPlacing(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {view === "3d" ? (
            <div className="v4-tools">
              <button type="button" className={cx("v4-tool", playing && "is-on")} onClick={() => (playing ? setPlaying(false) : play())}>
                {playing ? "Pause" : "Build it"}
              </button>
              <label className="v4-build">
                <span className="v4-mono">{layerNow}</span>
                <input type="range" min={0} max={LAYERS} step={0.01} value={sliderValue} aria-label="How much is standing" onChange={(e) => { setPlaying(false); setBuilt(Number(e.target.value)); }} />
              </label>
              <button type="button" className={cx("v4-tool", xray && "is-on")} aria-pressed={xray} onClick={() => setXray((x) => !x)}>
                X-ray
              </button>
              <button type="button" className={cx("v4-tool", connections && "is-on")} aria-pressed={connections} onClick={() => setConnections((c) => !c)} data-deck-connections>
                Connections
              </button>
              <button type="button" className={cx("v4-tool", night && "is-on")} aria-pressed={night} onClick={() => setNight((x) => !x)} data-deck-night>
                Night
              </button>
              {structure.frame ? (
                <button type="button" className={cx("v4-tool", placing?.kind === "stair" && "is-on")} aria-pressed={placing?.kind === "stair"} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => setPlacing(placing?.kind === "stair" ? null : { kind: "stair" })} data-deck-3d-add-stair>
                  {placing?.kind === "stair" ? "Click the deck…" : "+ Stairs"}
                </button>
              ) : null}
              <button type="button" className={cx("v4-tool", editing ? "is-on" : "v4-tool--breath")} aria-pressed={editing} title="Drag the deck, the stairs and the house's walls right in the 3D" onClick={() => setEditing((x) => !x)} data-deck-edit>
                Edit in 3D
              </button>
              <button type="button" className="v4-tool" onClick={() => { setResetToken((t) => t + 1); setPicked(null); }}>
                Reset view
              </button>
            </div>
          ) : null}
          {view === "3d" && picked ? (
            <div className="v4-picked" data-deck-picked>
              <div className="v4-picked-head">
                <b>{picked.legend.role}</b>
                <span>
                  {picked.legend.nominal}
                  {picked.legend.lengthFt ? ` · ${ftIn(picked.legend.lengthFt * 12)}` : ""}
                  {picked.legend.count > 1 ? ` · ${picked.legend.count} of them` : ""}
                </span>
              </div>
              <p>{picked.legend.note}</p>
              <div className="v4-acts">
                <button type="button" className="v4-btn v4-btn--sm" onClick={() => setFocus([...picked.point] as [number, number, number])}>
                  Zoom
                </button>
                <button type="button" className="v4-btn v4-btn--sm v4-btn--quiet" onClick={() => setPicked(null)}>
                  Close
                </button>
              </div>
            </div>
          ) : view === "3d" && connections ? (
            <p className="v4-picked v4-hint">Numbered tags mark the connections: click one to read how it is made and fly to it. Click any part to name it.</p>
          ) : null}
        </figure>
      </section>

      {/* ── WHAT KEEPS THE PACKAGE FROM BEING CLEAN ── */}
      <section className={cx("v4-issues", clean && "is-clean")} id="v4-issues" aria-label="Code checks">
        <div className="v4-issues-head">
          <h2 className="v4-h2">{clean ? "Code checks" : summary.fail ? (summary.fail === 1 ? "1 issue blocks a clean package" : `${summary.fail} issues block a clean package`) : `${summary.warn} to check before it goes out`}</h2>
          <div className="v4-acts">
            {summary.fail ? <span className="v4-stamp v4-stamp--bad">{summary.fail} to fix</span> : null}
            {summary.warn ? <span className="v4-stamp v4-stamp--warn">{summary.warn} to check</span> : null}
            <span className="v4-stamp v4-stamp--pass">{summary.pass} pass</span>
            {fixableCount ? (
              <button type="button" className="v4-btn v4-btn--sm v4-btn--primary" onClick={runAutoFix} data-deck-autofix>
                Fix {fixableCount === 1 ? "it" : `all ${fixableCount}`} for me
              </button>
            ) : null}
          </div>
        </div>
        {summary.fail ? <p className="v4-issues-sub">The proposal can still be made, but fix the frame before the client sees it. Estimating grade — the building department decides.</p> : clean ? <p className="v4-issues-sub">{issues.length ? "" : `${summary.pass} checks pass — every number names the table it is sized from.`} Estimating grade — the building department decides.</p> : null}
        {autoNotes.length ? (
          <p className="v4-call v4-call--info" role="status" data-deck-autofix-notes>
            Re-sized to the tables: {autoNotes.join(" · ")}.
          </p>
        ) : null}
        {fixReport ? (
          <div className={cx("v4-call", fixReport.left.length ? "v4-call--warn" : "v4-call--pass", "v4-report")} role="status" data-deck-fix-report>
            <button type="button" className="v4-report-x" onClick={() => setFixReport(null)} aria-label="Close">
              Close
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
                <ul>
                  {fixReport.left.slice(0, 8).map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Every check passes or is a note.</p>
            )}
          </div>
        ) : null}
        {loudOnes.length ? <ul className="v4-issue-list">{loudOnes.map((c) => checkRow(c))}</ul> : null}
        {quietOnes.length ? (
          <details className="v4-more" data-deck-checks-more>
            <summary>
              {(() => {
                const notes = quietOnes.filter((c) => c.level === "info").length;
                const passes = quietOnes.filter((c) => c.level === "pass").length;
                return [notes ? `${notes} ${notes === 1 ? "note" : "notes"}` : "", passes ? `${passes} passed` : ""].filter(Boolean).join(" and ");
              })()}
            </summary>
            <ul className="v4-issue-list">{quietOnes.map((c) => checkRow(c))}</ul>
          </details>
        ) : null}
      </section>

      {/* ── THE WORK: the package, and the choices that buy it ── */}
      <div className="v4-work">
        <section className="v4-pkg" id="v4-pkg" aria-label="Material package">
          <div className="v4-tabs" role="tablist" aria-label="The package">
            {(
              [
                ["package", "Material package"],
                ["proposal", "On the proposal"],
                ["prices", "Your prices"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`v4-tab-${id}`} aria-selected={tab === id} aria-controls={`v4-panel-${id}`} className={cx("v4-tab", tab === id && "is-on")} onClick={() => setTab(id)} data-v4-tab={id}>
                {label}
                {id === "prices" && exampleShare > 0 ? <span className="v4-tab-flag">{exampleShare}% examples</span> : null}
              </button>
            ))}
          </div>

          {tab === "package" ? (
            <div className="v4-panel" role="tabpanel" id="v4-panel-package" aria-labelledby="v4-tab-package">
              <div className="v4-panel-head">
                <p className="v4-panel-sub">
                  What to load on the truck, in the lengths the yard sells: {Math.round(pkg.takeoff.framingLf)} ft of framing · {pkg.takeoff.concreteBags} bags · {pkg.takeoff.footings} footings
                  {pkg.takeoff.roofSquares ? ` · ${pkg.takeoff.roofSquares} squares of roof` : ""}
                  {pkg.takeoff.stairRisers ? ` · ${pkg.takeoff.stairRisers} risers` : ""}
                  {pkg.takeoff.railLf ? ` · ${Math.round(pkg.takeoff.railLf)} ft of rail` : ""}.
                </p>
                {bomByStep.size ? (
                  <button type="button" className="v4-btn v4-btn--sm v4-btn--quiet" onClick={() => setBomShut((prev) => (prev.size ? new Set() : new Set(bomByStep.keys())))} data-bom-all>
                    {bomShut.size ? "Open every part" : "Fold every part"}
                  </button>
                ) : null}
              </div>
              <div className="v4-scroll">
                <table className="v4-table v4-bom">
                  <thead>
                    <tr>
                      <th className="v4-r">Qty</th>
                      <th>Item</th>
                      <th className="v4-r v4-each">Each</th>
                      <th className="v4-r">Cost</th>
                    </tr>
                  </thead>
                  {[...bomByStep].map(([step, rows]) => {
                    const open = !bomShut.has(step);
                    const sec = STEP_SEC[step];
                    return (
                      <tbody key={step} data-bom-step={step}>
                        <tr className="v4-group">
                          <td colSpan={2}>
                            <div className="v4-group-row">
                              <button type="button" className="v4-group-btn" aria-expanded={open} onClick={() => setBomShut((prev) => { const next = new Set(prev); if (next.has(step)) next.delete(step); else next.add(step); return next; })} data-bom-toggle={step}>
                                <span className="v4-caret" aria-hidden="true" />
                                {BOM_STEP_LABEL[step]}
                                <span className="v4-group-n">{rows.length === 1 ? "1 line" : `${rows.length} lines`}</span>
                              </button>
                              {sec && (sec !== "frame" || (withDeck && frame)) && (sec !== "deck" || pkg.takeoff.surface) && (sec !== "roof" || roof) && (sec !== "rails" || withDeck) ? (
                                <button type="button" className="v4-group-change" onClick={() => goSec(sec)} data-bom-change={step}>
                                  Change
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="v4-each" />
                          <td className="v4-r v4-nums v4-strong">{money(rows.reduce((a, l) => a + l.cost, 0), true)}</td>
                        </tr>
                        {open
                          ? rows.map((l) => (
                              <tr key={l.id} className="v4-line">
                                <td className="v4-r v4-nums">
                                  {l.qty.toLocaleString("en-US")} <span className="v4-unit">{l.unit}</span>
                                </td>
                                <td>
                                  <div className="v4-line-name">
                                    {l.label}
                                    {l.byClient ? <span className="v4-tbd">by the client</span> : null}
                                  </div>
                                  {l.note ? <div className="v4-line-note">{l.note}</div> : null}
                                </td>
                                <td className="v4-r v4-nums v4-each">
                                  {l.byClient ? "—" : money(l.unitPrice, true)}
                                  {l.source === "store" && !l.byClient ? (
                                    <span className="v4-src" title={`${STORE_SURVEY.label} — set yours under Your prices`} data-price-source="store">
                                      {STORE_SURVEY.short}
                                    </span>
                                  ) : l.source !== "book" && !l.byClient ? (
                                    <span className="v4-src" title="An example price — set yours under Your prices" data-price-source="example">
                                      ex
                                    </span>
                                  ) : null}
                                </td>
                                <td className="v4-r v4-nums">{l.byClient ? "TBD" : money(l.cost, true)}</td>
                              </tr>
                            ))
                          : null}
                      </tbody>
                    );
                  })}
                  <tfoot>
                    <tr>
                      <td />
                      <td>Material, before tax</td>
                      <td className="v4-each" />
                      <td className="v4-r v4-nums v4-strong">{money(pkg.materialSubtotal, true)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Anything no list carries: on the material list and in the price as typed. */}
              <div className="v4-own" data-deck-own-items>
                <div className="v4-own-head">
                  <h3 className="v4-h3">Not on the list? Add your own</h3>
                  {design.extras.items.length ? <span className="v4-mono">{design.extras.items.length} of {CUSTOM_LIMITS.items}</span> : null}
                </div>
                {design.extras.items.map((it) => (
                  <div key={it.id} className="v4-own-row" data-deck-own={it.id}>
                    <Field label="Item">
                      <NameInput label="Item name" value={it.name} onCommit={(name) => setOwnItem(it.id, { name })} />
                    </Field>
                    <Field label="Qty">
                      <NumberInput label={`${it.name}: quantity`} value={it.qty} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.qty.min} max={CUSTOM_LIMITS.qty.max} onCommit={(qty) => setOwnItem(it.id, { qty })} />
                    </Field>
                    <Field label="Unit">
                      <select className="v4-sel" value={it.unit} onChange={(e) => setOwnItem(it.id, { unit: e.target.value as OwnUnit })} aria-label={`${it.name}: unit`}>
                        {OWN_UNITS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Price" aside={`$ per ${it.unit}`}>
                      <NumberInput label={`${it.name}: price per ${it.unit}`} value={it.price} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.price.min} max={CUSTOM_LIMITS.price.max} onCommit={(price) => setOwnItem(it.id, { price })} />
                    </Field>
                    <button type="button" className="v4-btn v4-btn--sm v4-btn--danger" onClick={() => setOwnItems((list) => list.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.name}`}>
                      Remove
                    </button>
                  </div>
                ))}
                {design.extras.items.length < CUSTOM_LIMITS.items ? (
                  <form
                    className="v4-own-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addOwnItem();
                    }}
                    data-deck-own-new
                  >
                    <Field label="Item">
                      <input className="v4-in" placeholder="A brand or a part no list here carries" maxLength={CUSTOM_LIMITS.name} value={ownDraft.name} onChange={(e) => setOwnDraft((d) => ({ ...d, name: e.target.value }))} aria-label="New item's name" />
                    </Field>
                    <Field label="Qty">
                      <input className="v4-in v4-num" inputMode="decimal" value={ownDraft.qty} onChange={(e) => setOwnDraft((d) => ({ ...d, qty: e.target.value }))} aria-label="New item's quantity" />
                    </Field>
                    <Field label="Unit">
                      <select className="v4-sel" value={ownDraft.unit} onChange={(e) => setOwnDraft((d) => ({ ...d, unit: e.target.value as OwnUnit }))} aria-label="New item's unit">
                        {OWN_UNITS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Price" aside={`$ per ${ownDraft.unit}`}>
                      <input className="v4-in v4-num" inputMode="decimal" placeholder="0.00" value={ownDraft.price} onChange={(e) => setOwnDraft((d) => ({ ...d, price: e.target.value }))} aria-label="New item's price per unit" />
                    </Field>
                    <button type="submit" className="v4-btn v4-btn--sm" disabled={!ownDraft.name.trim()}>
                      Add
                    </button>
                  </form>
                ) : null}
                <p className="v4-hint">Goes on the material list under Your own items and into the price as typed. Every list in the choices ends with Custom too.</p>
              </div>
            </div>
          ) : tab === "proposal" ? (
            <div className="v4-panel" role="tabpanel" id="v4-panel-proposal" aria-labelledby="v4-tab-proposal">
              <div className="v4-panel-head">
                <p className="v4-panel-sub">The lines the proposal carries, material and labor apart. It can still be edited line by line once made.</p>
              </div>
              <div className="v4-scroll">
                <table className="v4-table">
                  <thead>
                    <tr>
                      <th>On the proposal</th>
                      <th className="v4-r">Qty</th>
                      <th className="v4-r v4-each">Material</th>
                      <th className="v4-r v4-each">Labor</th>
                      <th className="v4-r">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pkg.lines.map((l) => (
                      <tr key={l.id} data-line={l.id} className="v4-line">
                        <td>
                          <div className="v4-line-name">
                            {l.name}
                            {l.tbd ? <span className="v4-tbd">to be determined</span> : null}
                          </div>
                          {l.description ? <div className="v4-line-note">{l.description}</div> : null}
                        </td>
                        <td className="v4-r v4-nums">
                          {l.quantity.toLocaleString("en-US")} <span className="v4-unit">{l.unit}</span>
                        </td>
                        <td className="v4-r v4-nums v4-each">{money(l.materialCost, true)}</td>
                        <td className="v4-r v4-nums v4-each">{money(l.laborCost, true)}</td>
                        <td className="v4-r v4-nums v4-strong">{money(l.quantity * l.unitPrice, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Subtotal, before tax</td>
                      <td />
                      <td className="v4-each" />
                      <td className="v4-each" />
                      <td className="v4-r v4-nums v4-strong">{money(pkg.subtotal, true)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="v4-panel" role="tabpanel" id="v4-panel-prices" aria-labelledby="v4-tab-prices">
              <div className="v4-panel-head">
                <p className="v4-panel-sub">
                  Every default is an example, scaled to {market.label}. Type your own and save: your number is charged as typed on every deck from then on. Leave a row blank to go back to the example. The same book is on the <Link href={"/dashboard/deck-estimator/inventory" as Route}>deck inventory page</Link>.
                </p>
                <div className="v4-acts">
                  {saving === "saved" && !unsaved ? <span className="v4-stamp v4-stamp--pass">Saved</span> : null}
                  {saving === "failed" ? <span className="v4-stamp v4-stamp--bad">Not saved</span> : null}
                  <button type="button" className="v4-btn v4-btn--sm v4-btn--primary" disabled={!unsaved || saving === "saving"} onClick={saveBook}>
                    {saving === "saving" ? "Saving…" : "Save my prices"}
                  </button>
                </div>
              </div>
              <div className="v4-rates" id="deck-rates">
                {(Object.keys(DECK_RATE_GROUP_LABEL) as DeckRateGroup[]).map((group) => (
                  <details key={group} className="v4-rate-group">
                    <summary>
                      <span>{DECK_RATE_GROUP_LABEL[group]}</span>
                      <span className="v4-mono">{DECK_RATES.filter((rt) => rt.group === group && draftBook[rt.key] !== undefined).length || "no"} set</span>
                    </summary>
                    <div className="v4-rate-rows">
                      {DECK_RATES.filter((rt) => rt.group === group).map((rt) => {
                        const example = deckRate(rt.key, undefined, market).price;
                        return (
                          <label key={rt.key} className="v4-rate">
                            <span className="v4-rate-name">{rt.label}</span>
                            <span className="v4-rate-unit">
                              per {rt.unit}
                              {rt.basis !== "labor" && storePrice(rt.key) ? ` · ${STORE_SURVEY.short} ${STORE_SURVEY.asOf.slice(0, 7)}` : ""}
                            </span>
                            <input className="v4-in v4-num v4-rate-in" inputMode="decimal" placeholder={example.toFixed(2)} value={drafts2[rt.key] ?? ""} onChange={(e) => setDrafts2((d) => ({ ...d, [rt.key]: e.target.value }))} />
                          </label>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── the choices: every option says what it does to the price ── */}
        <aside className="v4-choices" aria-label="Design choices">
          <div className="v4-choices-head">
            <h2 className="v4-h2">Choices</h2>
            <p className="v4-choices-sub">Each option shows what it does to {money(pkg.subtotal)}.</p>
          </div>
          <FieldScope.Provider value={rootScope}>
            <Section id="what" title="What it is" summary={structureSummary} open={openSecs.has("what")} onToggle={() => toggleSec("what")} step="step-structure">
              <div className="v4-kinds" role="radiogroup" aria-label="What to build">
                <KindCards ctx={ctx} value={design.structure} onPick={setStructure} />
              </div>
              {design.structure === "gazebo" || design.structure === "pergola" ? (
                <Field label="It stands on" wide>
                  <Priced ctx={ctx} label="It stands" value={design.floor} cols={3} onPick={(f: Floor) => patch({ floor: f })} options={(["deck", "slab", "ground"] as const).map((f) => ({ value: f, name: FLOOR_LABEL[f], apply: (d: DeckDesign) => applyDeckPatch(d, { floor: f }) }))} />
                </Field>
              ) : null}
              {!withDeck ? <p className="v4-hint">{design.floor === "slab" ? "A new 4-in. slab a foot wider than the posts goes in the price; the posts sit on anchored bases." : "Each post gets its own poured footing, sized for what it carries."}</p> : null}
              <div className="v4-sub">
                <h4 className="v4-h4">Start from a sample</h4>
                <p className="v4-hint">Your address, state, house and lumber stay as set — the sample brings the shape, height, rails, stairs and roof.</p>
                <Priced
                  ctx={ctx}
                  label="Start from a sample"
                  value={applied && applied.design === design ? applied.id : null}
                  onPick={(id) => {
                    const sm = samplesFor(design.structure).find((x) => x.id === id);
                    if (sm) applySample(sm);
                  }}
                  options={samplesFor(design.structure).map((sm) => ({ value: sm.id, name: sm.name, sub: sm.facts, apply: (d: DeckDesign) => sampleDesignOver(d, sm, (x) => settleDesign(x, { rates: ctx.rates, market: ctx.market }).design) }))}
                  totals
                />
              </div>
            </Section>

            {!withDeck ? (
              <Section id="size" title={design.structure === "pergola" ? "The pergola's footprint" : "The gazebo's footprint"} summary={sizeWords(design)} open={openSecs.has("size")} onToggle={() => toggleSec("size")} step="step-footprint">
                {outlineBlock}
              </Section>
            ) : (
              <Section id="size" title={design.structure === "gazebo" || design.structure === "pergola" ? "The deck under it" : "Size and shape"} summary={shapeSummary} open={openSecs.has("size")} onToggle={() => toggleSec("size")} step="step-shape">
                <Field label="Shape" wide>
                  <Seg label="Shape" value={design.shape.kind} onChange={(k) => patch({ shape: k === "rect" ? { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt } : { kind: "L", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, notch: { corner: "front-right", widthFt: Math.max(2, Math.round(design.shape.widthFt / 2)), depthFt: Math.max(2, Math.round(design.shape.depthFt / 2)) } } })} options={[{ value: "rect", label: "Rectangle" }, { value: "L", label: "L-shaped" }]} />
                </Field>
                <div className="v4-grid2">
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
                      <Seg label="Corner cut away" value={design.shape.notch.corner} onChange={(c) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, corner: c } } })} options={NOTCH_CORNERS.map((c) => ({ value: c, label: CORNER_LABEL[c] }))} />
                    </Field>
                    <div className="v4-grid2">
                      <Field label="Cut along the house" aside="ft">
                        <NumberInput label="Corner cut along the house, feet" value={design.shape.notch.widthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.widthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, widthFt: n2 } } })} />
                      </Field>
                      <Field label="Cut out from the house" aside="ft">
                        <NumberInput label="Corner cut out from the house, feet" value={design.shape.notch.depthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.depthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, depthFt: n2 } } })} />
                      </Field>
                    </div>
                    <p className="v4-hint">A back corner is where the house steps out into the deck — a bump-out or a bay.</p>
                  </>
                ) : (
                  <>
                    <Field label="The front edge" wide>
                      <Priced
                        ctx={ctx}
                        label="The front edge"
                        cols={3}
                        value={front?.kind ?? "straight"}
                        onPick={(k: FrontKind) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: k === "straight" ? undefined : { kind: k, bulgeFt: front?.bulgeFt ?? 2, clipFt: front?.clipFt ?? 2 } } })}
                        options={(["straight", "curve", "clipped"] as const).map((k) => ({ value: k, name: FRONT_LABEL[k], apply: (d: DeckDesign) => (d.shape.kind === "rect" ? applyDeckPatch(d, { shape: { kind: "rect", widthFt: d.shape.widthFt, depthFt: d.shape.depthFt, front: k === "straight" ? undefined : { kind: k, bulgeFt: d.shape.front?.bulgeFt ?? 2, clipFt: d.shape.front?.clipFt ?? 2 } } }) : d) }))}
                      />
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
                    <div className="v4-sub">
                      <PToggle ctx={ctx} checked={design.lower.on} onChange={(v) => patch({ lower: { on: v } })} flip={(d) => settleDesign(applyDeckPatch(d, { lower: { on: !d.lower.on } }), { rates: ctx.rates, market: ctx.market }).design}>
                        A lower level in front, a step down
                      </PToggle>
                      {design.lower.on ? (
                        <Scope level="lower">
                          <div className="v4-grid2">
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
                          <p className="v4-hint">One riser (up to 7¾ in.) is a step the lower deck itself makes; more than that wants a stair between the levels — the checks offer one.</p>
                        </Scope>
                      ) : null}
                    </div>
                    <div className="v4-sub">
                      <PToggle ctx={ctx} checked={design.spa.on} onChange={(v) => patch({ spa: { on: v } })} flip={(d) => applyDeckPatch(d, { spa: { on: !d.spa.on } })}>
                        A hot-tub spot — the frame under it doubled
                      </PToggle>
                      {design.spa.on ? (
                        <>
                          <div className="v4-grid2">
                            <Field label="Tub, along the house" aside="ft">
                              <NumberInput label="Hot tub width, feet" value={design.spa.widthFt} parse={parseFeet} format={feetText} min={SPA_LIMITS.widthFt.min} max={Math.min(SPA_LIMITS.widthFt.max, design.shape.widthFt - 1)} onCommit={(n2) => patch({ spa: { widthFt: n2 } })} />
                            </Field>
                            <Field label="Tub, out from the house" aside="ft">
                              <NumberInput label="Hot tub depth, feet" value={design.spa.depthFt} parse={parseFeet} format={feetText} min={SPA_LIMITS.depthFt.min} max={Math.min(SPA_LIMITS.depthFt.max, design.shape.depthFt - 1)} onCommit={(n2) => patch({ spa: { depthFt: n2 } })} />
                            </Field>
                            <Field label="Set">
                              <Seg label="Where the tub stands" value={design.spa.align} onChange={(a) => patch({ spa: { align: a } })} options={[{ value: "left", label: "Left" }, { value: "centre", label: "Centre" }, { value: "right", label: "Right" }]} />
                            </Field>
                          </div>
                          <p className="v4-hint">Every joist under the tub is doubled and the checks read the frame at the filled weight (≈100 psf). The tub itself is by others.</p>
                        </>
                      ) : null}
                    </div>
                  </>
                )}
              </Section>
            )}

            {scene.house ? (
              <Section id="house" title="The house" summary={houseWords(design.house)} open={openSecs.has("house")} onToggle={() => toggleSec("house")} step="step-house">
                <p className="v4-hint">Drawn for the look: drag any part of the back wall in or out, tap + for a step, and size the {what.toLowerCase()} by its ends and front edge.</p>
                <div className="v4-grid2">
                  <Field label="Storeys">
                    <Seg label="Storeys" value={String(design.house.storeys)} onChange={(v) => setHouse({ storeys: v === "2" ? 2 : 1 })} options={[{ value: "1", label: "One" }, { value: "2", label: "Two" }]} />
                  </Field>
                  <Field label="Roof">
                    <Seg label="Roof" value={design.house.roof} onChange={(v: HouseRoof) => setHouse({ roof: v })} options={HOUSE_ROOFS.map((hr) => ({ value: hr, label: HOUSE_ROOF_LABEL[hr] }))} />
                  </Field>
                </div>
                <Field label="The back wall and the deck, seen from above — drag anything" wide lights={null}>
                  <div className="v4-quiet" onPointerDownCapture={quiet} data-deck-wall-quiet>
                    <HouseWallPlan shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} onOpenLarge={openWallLarge} />
                  </div>
                </Field>
                <Field label="Siding" wide>
                  <div className="v4-swatches" role="group" aria-label="Siding">
                    {SIDINGS.map((c) => (
                      <button key={c.id} type="button" className={cx("v4-swatch", design.house.siding === c.id && "is-on")} aria-pressed={design.house.siding === c.id} onClick={() => setHouse({ siding: c.id })} data-deck-house-siding={c.id}>
                        <span className="v4-swatch-c" style={{ background: c.hex }} aria-hidden />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Roof colour" wide>
                  <div className="v4-swatches" role="group" aria-label="Roof colour">
                    {ROOF_COLOURS.map((c) => (
                      <button key={c.id} type="button" className={cx("v4-swatch", design.house.roofColour === c.id && "is-on")} aria-pressed={design.house.roofColour === c.id} onClick={() => setHouse({ roofColour: c.id })} data-deck-house-roof-colour={c.id}>
                        <span className="v4-swatch-c" style={{ background: c.hex }} aria-hidden />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <p className={houseNotes(design.shape, design.house).length ? "v4-call v4-call--bad" : "v4-hint"} data-deck-wall-words>
                  {wallWords(design.shape, design.house)}
                </p>
                <Field label="The wall's shape" wide>
                  <div className="v4-chips" role="group" aria-label="The wall's shape">
                    {QUICK_WALLS.map((k) => (
                      <button key={k} type="button" className={cx("v4-chip", quickWallOf(design.shape, design.house) === k && "is-on")} aria-pressed={quickWallOf(design.shape, design.house) === k} onClick={() => setHouse(quickWall(k, design.shape, design.house))} data-deck-wall-quick={k}>
                        {QUICK_WALL_LABEL[k]}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="v4-grid2">
                  <Field label="Wall past the deck's left end" aside="ft" lights={lightsFor({ kind: "left" })}>
                    <NumberInput label="Wall past the left end, feet" value={design.house.leftFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ leftFt: n2 })} />
                  </Field>
                  <Field label="Wall past the deck's right end" aside="ft" lights={lightsFor({ kind: "right" })}>
                    <NumberInput label="Wall past the right end, feet" value={design.house.rightFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ rightFt: n2 })} />
                  </Field>
                </div>
                <div className="v4-rows" data-deck-house-jogs>
                  {design.house.jogs.map((j, i) => (
                    <div key={j.id} className="v4-card" data-deck-house-jog={j.id}>
                      <div className="v4-card-head">
                        <span className="v4-card-title">
                          Step {i + 1} — {stepWords(j, design.shape)}
                        </span>
                        <button type="button" className="v4-btn v4-btn--sm v4-btn--danger" onClick={() => setHouse({ jogs: design.house.jogs.filter((x) => x.id !== j.id) })} data-deck-house-jog-remove>
                          Remove
                        </button>
                      </div>
                      <div className="v4-grid2">
                        <Field label="Where, from the deck's left end" aside="ft" lights={lightsFor({ kind: "step", id: j.id })}>
                          <NumberInput label="Step at, feet from the deck's left end" value={j.atFt} parse={parseFeet} format={feetText} min={-design.house.leftFt + 1} max={design.shape.widthFt + design.house.rightFt - 1} onCommit={(n2) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, atFt: n2 } : x)) })} />
                        </Field>
                        <Field label="By" aside="ft" lights={lightsFor({ kind: "part", id: j.id })}>
                          <NumberInput label="By, feet" value={j.depthFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.depthFt.min} max={HOUSE_LIMITS.depthFt.max} onCommit={(n2) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, depthFt: n2 } : x)) })} />
                        </Field>
                        <Field label="The wall to its right" wide lights={lightsFor({ kind: "part", id: j.id })}>
                          <Seg label="The wall to its right" value={j.dir} onChange={(v: HouseJog["dir"]) => setHouse({ jogs: design.house.jogs.map((x) => (x.id === j.id ? { ...x, dir: v } : x)) })} options={[{ value: "toward", label: "Comes out" }, { value: "away", label: "Steps back" }]} />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="v4-btn v4-btn--sm" disabled={design.house.jogs.length >= HOUSE_LIMITS.jogs} onClick={() => setHouse({ jogs: [...design.house.jogs, { id: nextJogId(design.house.jogs), atFt: Math.max(2, design.shape.widthFt - 4), dir: "toward", depthFt: 3 }] })} data-deck-house-add-jog>
                  + Add a step in the wall
                </button>
              </Section>
            ) : null}

            <Section id="site" title={withDeck ? "Height and ground" : "Site"} summary={heightSummary} open={openSecs.has("site")} onToggle={() => toggleSec("site")} step="step-site">
              {withDeck ? (
                <>
                  <Field label="How it meets the house" wide>
                    <Priced ctx={ctx} label="How it meets the house" cols={3} value={design.placement} onPick={(p: Placement) => patch({ placement: p })} options={(["attached", "beside", "detached"] as const).map((p) => ({ value: p, name: PLACEMENT_LABEL[p].split(" — ")[0], apply: (d: DeckDesign) => applyDeckPatch(d, { placement: p }) }))} />
                  </Field>
                  {design.placement !== "detached" ? (
                    <Field label="The house wall there" wide>
                      <select className="v4-sel" value={design.wall} onChange={(e) => patch({ wall: e.target.value as DeckDesign["wall"] })}>
                        {WALL_TYPES.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.label}
                            {w.ledger ? "" : " — no ledger"}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  {design.placement !== "detached" && !wall.ledger ? <p className="v4-call v4-call--warn">{wall.why}</p> : null}
                  <div className="v4-grid2">
                    <Field label="Deck height" aside={`in. · ${ftIn(design.heightIn)}`}>
                      <NumberInput label="Height of the deck surface above the ground, inches" value={design.heightIn} parse={parseInches} format={(n2) => String(Math.round(n2 * 4) / 4)} min={DECK_LIMITS.heightIn.min} max={DECK_LIMITS.heightIn.max} onCommit={(n2) => patch({ heightIn: n2 })} />
                    </Field>
                    <Field label="Frost depth" aside="in.">
                      <NumberInput label="Frost depth, inches" value={design.frostIn} parse={intText} format={String} min={0} max={96} onCommit={(n2) => patch({ frostIn: n2 }, ["frost"])} />
                    </Field>
                  </div>
                  <div className="v4-chips">
                    {HEIGHT_PRESETS.map((h) => (
                      <button key={h.label} type="button" className={cx("v4-chip", design.heightIn === h.inches && "is-on")} onClick={() => patch({ heightIn: h.inches })}>
                        {h.label} <span>{ftIn(h.inches)}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="v4-grid2">
                  <Field label="Frost depth" aside="in.">
                    <NumberInput label="Frost depth, inches" value={design.frostIn} parse={intText} format={String} min={0} max={96} onCommit={(n2) => patch({ frostIn: n2 }, ["frost"])} />
                  </Field>
                  <Field label="Footings stand above grade" aside="in.">
                    <NumberInput label="Top of the footings above the ground, inches" value={design.footing.aboveGradeIn} parse={intText} format={String} min={DECK_LIMITS.aboveGradeIn.min} max={DECK_LIMITS.aboveGradeIn.max} onCommit={(n2) => patch({ footing: { aboveGradeIn: n2 } })} />
                  </Field>
                </div>
              )}
              <div className="v4-grid2">
                <Field label="Design load" aside={design.site.groundSnowPsf > 40 ? `snow here ${design.site.groundSnowPsf} psf` : "live or snow"}>
                  <select className="v4-sel" value={design.loadPsf} onChange={(e) => patch({ loadPsf: Number(e.target.value) as LoadPsf }, ["load"])}>
                    {LOADS.map((l) => (
                      <option key={l} value={l}>
                        {l === 40 ? "40 psf — live load" : `${l} psf ground snow`}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Soil bears">
                  <select className="v4-sel" value={design.soilPsf} onChange={(e) => patch({ soilPsf: Number(e.target.value) as SoilPsf })}>
                    <option value={1500}>1,500 psf (code default)</option>
                    <option value={2000}>2,000 psf</option>
                    <option value={3000}>3,000 psf or more</option>
                  </select>
                </Field>
              </div>
              <div className="v4-sub" data-deck-site>
                <h4 className="v4-h4">The ground</h4>
                <div className="v4-grid2">
                  <Field label="Falls away from the house" aside={`in. over ${design.shape.depthFt} ft`}>
                    <NumberInput label="How far the ground falls away from the house across the deck, inches" value={design.site.slope.outDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, outDropIn: n2 } } })} />
                  </Field>
                  <Field label="Falls left to right" aside={`in. over ${design.shape.widthFt} ft`}>
                    <NumberInput label="How far the ground falls left to right across the deck, inches" value={design.site.slope.acrossDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, acrossDropIn: n2 } } })} />
                  </Field>
                </div>
                <div className="v4-acts">
                  <button type="button" className="v4-btn v4-btn--sm" onClick={() => void readGround()} disabled={siteBusy || address.trim().length < 8} data-deck-read-ground>
                    {siteBusy ? "Reading the lidar…" : "Read the ground from the address"}
                  </button>
                  {design.site.slope.outDropIn || design.site.slope.acrossDropIn ? (
                    <button type="button" className="v4-btn v4-btn--sm v4-btn--quiet" onClick={() => patch({ site: { ...design.site, slope: { outDropIn: 0, acrossDropIn: 0 } } })}>
                      Level
                    </button>
                  ) : null}
                </div>
                {siteNote ? <p className="v4-hint">{siteNote}</p> : null}
                <details className="v4-more" data-deck-facts>
                  <summary>What the code and the site say here</summary>
                  <ul className="v4-facts-list">
                    <li data-deck-code>{site.codeLine}</li>
                    {site.basis.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                    {design.site.termite ? <li>Termite hazard here: {TERMITE_LABEL[design.site.termite]}.</li> : null}
                  </ul>
                </details>
              </div>
              {!withDeck && design.floor === "ground" && r.attach !== "wall" ? (
                <PToggle ctx={ctx} checked={design.footing.frostAlways} onChange={(v) => patch({ footing: { frostAlways: v } })} flip={(d) => applyDeckPatch(d, { footing: { frostAlways: !d.footing.frostAlways } })}>
                  Dig to the frost line anyway
                </PToggle>
              ) : null}
            </Section>

            {withDeck && frame ? (
              <Section id="frame" title="Framing and footings" summary={frameSummary} cost={secCost("frame")} open={openSecs.has("frame")} onToggle={() => toggleSec("frame")} step="Frame">
                <Field label="Footings" wide>
                  <Priced ctx={ctx} label="Footings" cols={2} value={design.footing.type} onPick={(v) => patch({ footing: { type: v } })} options={[{ value: "poured" as const, name: "Poured concrete", apply: (d: DeckDesign) => applyDeckPatch(d, { footing: { type: "poured" } }) }, { value: "pier-block" as const, name: "Precast pier blocks", apply: (d: DeckDesign) => applyDeckPatch(d, { footing: { type: "pier-block" } }) }]} />
                </Field>
                <Field label="Framing lumber" wide>
                  <select className="v4-sel" value={design.custom.species ? CUSTOM : design.framing.species} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("species") : patch({ framing: { species: e.target.value as DeckDesign["framing"]["species"] }, custom: { species: undefined } }, ["species"]))} data-deck-pick="species">
                    {speciesOptions}
                    <option value={CUSTOM}>{CUSTOM_LABEL}</option>
                  </select>
                </Field>
                {design.custom.species ? (
                  <CustomBox slot="species" title="Framing lumber" product={design.custom.species} unit={null} fresh={freshCustom === "species"} onDone={freshDone} onChange={(p) => setCustom("species", p)} onBack={() => setCustom("species", undefined)} note={`Named as typed on the plans and the material list. It spans by the code's tables for ${(FRAMING_SPECIES.find((f) => f.id === design.framing.species)?.label ?? "the lumber below").toLowerCase()} and is priced as that — your own lumber prices go under Your prices.`}>
                    <Field label="Spans and prices as" wide>
                      <select className="v4-sel" value={design.framing.species} onChange={(e) => patch({ framing: { species: e.target.value as DeckDesign["framing"]["species"] } }, ["species"])} data-deck-like="species">
                        {speciesOptions}
                      </select>
                    </Field>
                  </CustomBox>
                ) : (
                  <p className="v4-hint">{frame.species.note}</p>
                )}
                <Field label="Joist spacing" aside={design.framing.spacingIn === "auto" ? `${frame.spacingIn} in. on center` : "on center"} wide>
                  <Priced ctx={ctx} label="Joist spacing" cols={2} value={design.framing.spacingIn} onPick={(v) => patch({ framing: { spacingIn: v } })} options={(["auto", 12, 16, 24] as const).map((v) => ({ value: v, name: v === "auto" ? "Auto — as the boards ask" : `${v} in.`, apply: (d: DeckDesign) => applyDeckPatch(d, { framing: { spacingIn: v } }) }))} />
                </Field>
                <Field label="Joists" aside={design.framing.joist === "auto" ? `picked: ${frame.joistSize}` : undefined} wide>
                  <Seg label="Joists" value={design.framing.joist} onChange={(v) => patch({ framing: { joist: v } })} options={[{ value: "auto", label: "Auto" }, ...(["2x6", "2x8", "2x10", "2x12"] as const).map((j) => ({ value: j, label: j }))]} />
                </Field>
                <div className="v4-grid2">
                  <Field label="Beam size" aside={design.framing.beam === "auto" ? `picked: ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")}` : undefined}>
                    <select className="v4-sel" value={design.framing.beam} onChange={(e) => patch({ framing: { beam: e.target.value as DeckDesign["framing"]["beam"] } })}>
                      <option value="auto">Auto — least cost</option>
                      {(frame.beamKind === "solid" ? SOLID_BEAMS : BUILT_UP_CHOICES).map((b) => (
                        <option key={b} value={b}>{b.includes("-") ? `${b[0]}-ply ${b.slice(2)}` : b}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Posts">
                    <select className="v4-sel" value={design.framing.post} onChange={(e) => patch({ framing: { post: e.target.value as DeckDesign["framing"]["post"] } })}>
                      {POST_SIZES.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <details className="v4-more" data-deck-more-frame>
                  <summary>
                    More framing choices <span className="v4-more-sub">{frameMoreWords}</span>
                  </summary>
                  <div className="v4-more-body">
                    <Field label="Beams" aside={design.framing.beamStyle === "auto" ? (frame.beamStyle === "flush" ? "picked: flush" : "picked: under the joists") : undefined} wide>
                      <Seg label="Beams" value={design.framing.beamStyle} onChange={(v) => patch({ framing: { beamStyle: v } })} options={[{ value: "auto", label: "Auto" }, { value: "dropped", label: "Under the joists" }, { value: "flush", label: "Flush" }]} />
                    </Field>
                    <div className="v4-grid2">
                      <Field label="Beam made of">
                        <select className="v4-sel" value={frame.beamKind} onChange={(e) => patch({ framing: { beamKind: e.target.value as DeckDesign["framing"]["beamKind"], beam: "auto" } })} data-deck-beam-kind={frame.beamKind}>
                          <option value="solid" disabled={!solidBeamTabulated(frame.load, frame.group)}>
                            {solidBeamTabulated(frame.load, frame.group) ? "Solid 4x" : "Solid 4x — not in the code's tables for this lumber and load"}
                          </option>
                          <option value="built-up">Built up from 2x</option>
                        </select>
                        {frame.beamKindNote ? <p className="v4-call v4-call--warn" data-deck-beam-note>{frame.beamKindNote}</p> : null}
                      </Field>
                      <Field label="Joists past the beam" aside={design.framing.overhangFt === "auto" ? `auto: ${ftIn(frame.zones[0].frontCantIn)}` : "ft"}>
                        <select className="v4-sel" value={String(design.framing.overhangFt)} onChange={(e) => patch({ framing: { overhangFt: e.target.value === "auto" ? "auto" : Number(e.target.value) } })}>
                          <option value="auto">Auto — up to 2 ft</option>
                          {[0, 0.5, 1, 1.5, 2, 2.5, 3].map((v) => (
                            <option key={v} value={v}>{v === 0 ? "None" : feetText(v).replace(/^(\d+)$/, "$1 ft")}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="v4-toggles">
                      <PToggle ctx={ctx} checked={design.framing.doubleRim} onChange={(v) => patch({ framing: { doubleRim: v } })} flip={(d) => applyDeckPatch(d, { framing: { doubleRim: !d.framing.doubleRim } })}>
                        Doubled rim and outside joists
                      </PToggle>
                      <PToggle ctx={ctx} checked={design.framing.joistTape} onChange={(v) => patch({ framing: { joistTape: v } })} flip={(d) => applyDeckPatch(d, { framing: { joistTape: !d.framing.joistTape } })}>
                        Joist tape on every top
                      </PToggle>
                      <PToggle ctx={ctx} checked={design.framing.braces} onChange={(v) => patch({ framing: { braces: v } })} flip={(d) => applyDeckPatch(d, { framing: { braces: !d.framing.braces } })}>
                        Knee braces at corner posts over 2 ft
                      </PToggle>
                      <PToggle ctx={ctx} checked={design.framing.blocking === "mid-span"} onChange={(v) => patch({ framing: { blocking: v ? "mid-span" : "auto" } })} flip={(d) => applyDeckPatch(d, { framing: { blocking: d.framing.blocking === "mid-span" ? "auto" : "mid-span" } })}>
                        Mid-span blocking on spans over 8 ft
                      </PToggle>
                      {design.heightIn >= 84 ? (
                        <PToggle ctx={ctx} checked={design.extras.underDeckDrain} onChange={(v) => patch({ extras: { underDeckDrain: v } })} flip={(d) => applyDeckPatch(d, { extras: { underDeckDrain: !d.extras.underDeckDrain } })}>
                          Under-deck drainage — a dry room below
                        </PToggle>
                      ) : null}
                    </div>
                    {design.placement === "attached" ? (
                      <div className="v4-grid2">
                        <Field label="Ledger fastened with">
                          <select className="v4-sel" value={design.ledger.fastener} onChange={(e) => patch({ ledger: { fastener: e.target.value as DeckDesign["ledger"]["fastener"] } })}>
                            {wall.fasteners.map((f) => (
                              <option key={f} value={f}>{LEDGER_FASTENER_LABEL[f]}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Ties to the house">
                          <select className="v4-sel" value={design.ledger.lateral} onChange={(e) => patch({ ledger: { lateral: e.target.value as "two" | "four" } })}>
                            <option value="two">Two 1,500-lb hold-downs</option>
                            <option value="four">Four 750-lb ties</option>
                          </select>
                        </Field>
                      </div>
                    ) : null}
                    {design.placement !== "attached" ? (
                      <PToggle ctx={ctx} checked={design.footing.frostAlways} onChange={(v) => patch({ footing: { frostAlways: v } })} flip={(d) => applyDeckPatch(d, { footing: { frostAlways: !d.footing.frostAlways } })}>
                        Dig to the frost line anyway
                      </PToggle>
                    ) : null}
                  </div>
                </details>
              </Section>
            ) : null}

            {withDeck && frame && pkg.takeoff.surface ? (
              <Section id="deck" title="Decking and fasteners" summary={surfaceSummary} cost={secCost("deck")} open={openSecs.has("deck")} onToggle={() => toggleSec("deck")} step="Surface">
                <Field label="Boards and rail, in three steps" wide>
                  <Priced
                    ctx={ctx}
                    label="Good, better, best"
                    value={tierNow}
                    totals
                    onPick={(id) => {
                      const t = TIERS.find((x) => x.id === id);
                      if (t) patch({ decking: { product: t.decking(tierState) }, rail: { type: railFor(t) }, custom: { decking: undefined } }, ["decking"]);
                    }}
                    options={TIERS.map((t) => ({ value: t.id, name: t.name, sub: t.words, apply: (d: DeckDesign) => applyDeckPatch(d, { decking: { product: t.decking(tierState) }, rail: { type: d.rail.type === "none" && !structure.rails.required ? "none" : t.rail }, custom: { decking: undefined } }) }))}
                  />
                </Field>
                <Field label="Deck boards" wide>
                  <select className="v4-sel" value={design.custom.decking ? CUSTOM : design.decking.product} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("decking") : patch({ decking: { product: e.target.value }, custom: { decking: undefined } }, ["decking"]))} data-deck-pick="decking">
                    {deckingOptions}
                    <option value={CUSTOM}>{CUSTOM_LABEL}</option>
                  </select>
                </Field>
                {design.custom.decking ? (
                  <CustomBox slot="decking" title="Deck boards" product={design.custom.decking} unit="ft of board" fresh={freshCustom === "decking"} onDone={freshDone} onChange={(p) => setCustom("decking", p)} onBack={() => setCustom("decking", undefined)} note="Priced at your number per foot of board, the stair treads too. The joist spacing, the gaps and the clips follow the board it is laid like.">
                    <Field label="Laid like" wide>
                      <select className="v4-sel" value={design.decking.product} onChange={(e) => patch({ decking: { product: e.target.value } }, ["decking"])} data-deck-like="decking">
                        {deckingOptions}
                      </select>
                    </Field>
                  </CustomBox>
                ) : null}
                <p className="v4-hint">
                  Joists no more than {frame.decking.maxSpacingIn.square} in. apart ({frame.decking.maxSpacingIn.diagonal} in. on the diagonal) — {frame.decking.sourceNote}.{regional ? ` ${regionalWords(regional)}` : ""}
                </p>
                <Field label="Pattern" wide>
                  <Priced ctx={ctx} label="Pattern" cols={3} value={design.decking.pattern} onPick={(v) => patch({ decking: { pattern: v, diagonal: v !== "straight" } })} options={(["straight", "diagonal", "herringbone"] as const).map((v) => ({ value: v, name: PATTERN_LABEL[v], apply: (d: DeckDesign) => applyDeckPatch(d, { decking: { pattern: v, diagonal: v !== "straight" } }) }))} />
                </Field>
                <Field label="Picture-frame border" wide>
                  <Priced ctx={ctx} label="Picture-frame border" cols={3} value={design.decking.border} onPick={(v) => patch({ decking: { border: v } })} options={([0, 1, 2] as const).map((v) => ({ value: v, name: v === 0 ? "None" : v === 1 ? "One board" : "Two boards", apply: (d: DeckDesign) => applyDeckPatch(d, { decking: { border: v } }) }))} />
                </Field>
                <Field label="Fastened with" wide>
                  <Priced
                    ctx={ctx}
                    label="Fastened with"
                    cols={frame.decking.hiddenFasteners ? 3 : 2}
                    value={design.custom.fastening ? null : design.decking.fastening}
                    onPick={(v) => patch({ decking: { fastening: v }, custom: { fastening: undefined } })}
                    options={[
                      { value: "auto" as const, name: `Auto — ${pkg.takeoff.surface.fastening === "hidden" ? "clips" : "screws"}`, apply: (d: DeckDesign) => applyDeckPatch(d, { decking: { fastening: "auto" }, custom: { fastening: undefined } }) },
                      { value: "screws" as const, name: "Deck screws", apply: (d: DeckDesign) => applyDeckPatch(d, { decking: { fastening: "screws" }, custom: { fastening: undefined } }) },
                      ...(frame.decking.hiddenFasteners ? [{ value: "hidden" as const, name: "Hidden clips", apply: (d: DeckDesign) => applyDeckPatch(d, { decking: { fastening: "hidden" }, custom: { fastening: undefined } }) }] : []),
                    ]}
                  />
                </Field>
                {design.custom.fastening ? (
                  <CustomBox slot="fastening" title="Fastening" product={design.custom.fastening} unit="sq ft of deck" fresh={freshCustom === "fastening"} onDone={freshDone} onChange={(p) => setCustom("fastening", p)} onBack={() => setCustom("fastening", undefined)} note="Priced per square foot of deck — screws or clips and their bits, all in.">
                    {frame.decking.hiddenFasteners ? (
                      <Field label="Counted as" wide>
                        <Seg label="Fastening counted as" value={pkg.takeoff.surface.fastening} onChange={(v) => patch({ decking: { fastening: v } })} options={[{ value: "screws", label: "Face screws" }, { value: "hidden", label: "Hidden clips" }]} />
                      </Field>
                    ) : null}
                  </CustomBox>
                ) : (
                  <button type="button" className="v4-link" onClick={() => pickCustom("fastening")} data-deck-pick="fastening">
                    Your own fastening at your price…
                  </button>
                )}
                <Field label="Fascia" wide>
                  <Priced
                    ctx={ctx}
                    label="Fascia"
                    cols={3}
                    value={design.custom.fascia && pkg.takeoff.surface.fascia.on ? null : design.decking.fascia}
                    onPick={(v) => patch({ decking: { fascia: v }, custom: { fascia: undefined } })}
                    options={(["auto", "match", "none"] as const).map((v) => ({ value: v, name: v === "auto" ? `Auto — ${pkg.takeoff.surface?.fascia.on ? "on" : "none"}` : v === "match" ? "On the open edges" : "No fascia", apply: (d: DeckDesign) => applyDeckPatch(d, { decking: { fascia: v }, custom: { fascia: undefined } }) }))}
                  />
                </Field>
                {design.custom.fascia && pkg.takeoff.surface.fascia.on ? (
                  <CustomBox slot="fascia" title="Fascia" product={design.custom.fascia} unit="ft" fresh={freshCustom === "fascia"} onDone={freshDone} onChange={(p) => setCustom("fascia", p)} onBack={() => setCustom("fascia", undefined)} note="Priced per foot of fascia board, the stair risers too, bought in 12-ft lengths." />
                ) : (
                  <button type="button" className="v4-link" onClick={() => pickCustom("fascia")} data-deck-pick="fascia">
                    Your own fascia at your price…
                  </button>
                )}
                <div className="v4-grid2">
                  <Field label="Waste on the boards" aside="%">
                    <NumberInput label="Waste allowance on the boards, percent" value={design.decking.wastePct} parse={intText} format={String} min={0} max={30} onCommit={(n2) => patch({ decking: { wastePct: n2 } })} />
                  </Field>
                </div>
              </Section>
            ) : null}

            {withRoof && roof ? (
              <Section id="roof" title={design.structure === "pergola" ? "Pergola" : "Roof"} summary={roofSummary} cost={secCost("roof")} open={openSecs.has("roof")} onToggle={() => toggleSec("roof")} step="step-roof">
                {kinds.length > 1 ? (
                  <Field label="Roof shape" wide>
                    <Priced ctx={ctx} label="Roof shape" cols={2} value={r.kind} onPick={(k: RoofKind) => rp({ kind: k })} options={kinds.map((k) => ({ value: k, name: ROOF_KIND_LABEL[k].split(" — ")[0], apply: (d: DeckDesign) => applyDeckPatch(d, { roof: { ...d.roof, kind: k } }) }))} />
                  </Field>
                ) : null}
                {roof.kindNote ? <p className="v4-call v4-call--warn">{roof.kindNote}</p> : null}
                {canAttach ? (
                  <Field label="It stands" wide>
                    <Priced ctx={ctx} label="On the house or free" cols={2} value={r.attach} onPick={(a) => rp({ attach: a })} options={[{ value: "wall" as const, name: "On the house wall", apply: (d: DeckDesign) => applyDeckPatch(d, { roof: { ...d.roof, attach: "wall" } }) }, { value: "free" as const, name: "Free-standing", apply: (d: DeckDesign) => applyDeckPatch(d, { roof: { ...d.roof, attach: "free" } }) }]} />
                  </Field>
                ) : null}
                {withDeck ? outlineBlock : null}

                <div className="v4-sub">
                  <h4 className="v4-h4">Posts and headers</h4>
                  <div className="v4-grid2">
                    <Field label="Height to the headers" aside={`in. · ${ftIn(r.eaveHeightIn)}`}>
                      <NumberInput label="Height from the floor to the underside of the headers, inches" value={r.eaveHeightIn} parse={parseInches} format={String} min={ROOF_LIMITS.eaveHeightIn.min} max={ROOF_LIMITS.eaveHeightIn.max} onCommit={(n2) => rp({ eaveHeightIn: n2 })} />
                    </Field>
                    <Field label="Posts">
                      <Seg label="Roof posts" value={r.post} onChange={(p) => rp({ post: p })} options={(["4x4", "6x6", "8x8"] as const).map((p) => ({ value: p, label: p }))} />
                    </Field>
                  </div>
                  <div className="v4-chips">
                    {EAVE_PRESETS.map((h) => (
                      <button key={h.label} type="button" className={cx("v4-chip", r.eaveHeightIn === h.inches && "is-on")} onClick={() => rp({ eaveHeightIn: h.inches })}>
                        {h.label} <span>to the headers</span>
                      </button>
                    ))}
                  </div>
                  <div className="v4-grid2">
                    <Field label="Headers (beams on the posts)" aside={r.header === "auto" ? `picked: ${[...new Set(roof.headers.map((h) => h.spec.size))].join(", ") || "—"}` : undefined}>
                      <select className="v4-sel" value={r.header} onChange={(e) => rp({ header: e.target.value as RoofDesign["header"] })}>
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
                      <select className="v4-sel" value={r.overhangIn} onChange={(e) => rp({ overhangIn: Number(e.target.value) })}>
                        {OVERHANGS.map((o) => (
                          <option key={o} value={o}>{o === 0 ? "None" : `${o} in.`}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <PToggle ctx={ctx} checked={r.braces} onChange={(v) => rp({ braces: v })} flip={(d) => applyDeckPatch(d, { roof: { ...d.roof, braces: !d.roof.braces } })}>
                    Knee braces at the posts
                  </PToggle>
                  <Field label="Walls between the posts" wide>
                    <Priced
                      ctx={ctx}
                      label="Walls between the posts"
                      cols={2}
                      value={design.custom.walls && r.walls.fill !== "none" ? null : r.walls.fill}
                      onPick={(v) => {
                        rp({ walls: { ...r.walls, fill: v } });
                        dropCustom("walls");
                      }}
                      options={(["none", "screen", "lattice", "solid"] as const).map((v) => ({ value: v, name: WALL_FILL_LABEL[v].split(",")[0], apply: (d: DeckDesign) => applyDeckPatch(d, { roof: { ...d.roof, walls: { ...d.roof.walls, fill: v } }, custom: { walls: undefined } }) }))}
                    />
                  </Field>
                  {design.custom.walls && r.walls.fill !== "none" ? (
                    <CustomBox slot="walls" title="Walls" product={design.custom.walls} unit="sq ft of wall" fresh={freshCustom === "walls"} onDone={freshDone} onChange={(p) => setCustom("walls", p)} onBack={() => setCustom("walls", undefined)} note="Priced per square foot of wall, framed, as the list's panels are.">
                      <Field label="Built like" wide>
                        <Seg label="Walls built like" value={r.walls.fill} onChange={(v) => rp({ walls: { ...r.walls, fill: v } })} options={(["screen", "lattice", "solid"] as const).map((v) => ({ value: v, label: WALL_FILL_LABEL[v].split(",")[0] }))} />
                      </Field>
                    </CustomBox>
                  ) : (
                    <button type="button" className="v4-link" onClick={() => pickCustom("walls")}>
                      Your own walls at your price…
                    </button>
                  )}
                  {r.walls.fill !== "none" ? (
                    <Field label="On how many sides" aside={`of ${roof.ring.length - (roof.attach === "wall" ? 1 : 0)} open`} wide>
                      <NumberInput label="How many sides get walls" value={r.walls.sides} parse={intText} format={String} min={1} max={Math.max(1, roof.ring.length - (roof.attach === "wall" ? 1 : 0))} onCommit={(n2) => rp({ walls: { ...r.walls, sides: n2 } })} />
                    </Field>
                  ) : null}
                </div>

                <div className="v4-sub">
                  <h4 className="v4-h4">{design.structure === "pergola" ? "Rafters and slats" : "Rafters and ridge"}</h4>
                  {design.structure !== "pergola" ? (
                    <Field label="Pitch" aside={`${r.pitch}:12 · ${Math.round(Math.atan(r.pitch / 12) * (180 / Math.PI))}°`} wide>
                      <Seg label="Pitch" value={r.pitch} onChange={(p) => rp({ pitch: p })} options={PITCHES.map((p) => ({ value: p, label: `${p}:12` }))} />
                    </Field>
                  ) : (
                    <Field label="The top" wide>
                      <Priced ctx={ctx} label="Pergola top" cols={3} value={r.pergolaStyle} onPick={(v) => rp({ pergolaStyle: v })} options={(["flat", "louvered", "arched"] as const).map((v) => ({ value: v, name: PERGOLA_STYLE_LABEL[v], apply: (d: DeckDesign) => applyDeckPatch(d, { roof: { ...d.roof, pergolaStyle: v } }) }))} />
                    </Field>
                  )}
                  <Field label="Rafters" aside={roof.trusses ? "trusses frame this roof" : r.rafter === "auto" ? `picked: ${roof.rafters.size}` : undefined} wide>
                    <Seg label="Rafters" value={r.rafter} onChange={(v) => rp({ rafter: v })} options={[{ value: "auto", label: "Auto" }, ...(["2x6", "2x8", "2x10", "2x12"] as const).map((j) => ({ value: j, label: j }))]} />
                  </Field>
                  <Field label="Rafter spacing" aside="on center" wide>
                    <Seg label="Rafter spacing" value={r.rafterSpacingIn} onChange={(v) => rp({ rafterSpacingIn: v })} options={[{ value: 12, label: '12"' }, { value: 16, label: '16"' }, { value: 24, label: '24"' }]} />
                  </Field>
                  {r.kind === "gable" || r.kind === "hip" || r.kind === "gambrel" ? (
                    <Field label="At the ridge" aside={r.ridge === "auto" ? (roof.trusses ? "picked: trusses" : roof.ridge ? `picked: ${roof.ridge.kind === "beam" ? "ridge beam" : "ridge board"}` : undefined) : undefined} wide>
                      <Seg label="At the ridge" value={r.ridge} onChange={(v) => rp({ ridge: v })} options={[{ value: "auto", label: "Auto" }, { value: "beam", label: "Ridge beam", title: r.kind === "hip" ? "A beam on two king posts, each standing on a cross beam from eave header to eave header; the ceiling stays open" : "The rafters bear on a beam; the ceiling stays open" }, { value: "board", label: "Ridge board + ties", title: "A board between the rafters, with rafter ties every 4 ft" }, ...(r.kind === "gable" ? [{ value: "trusses" as const, label: "Trusses", title: "Manufactured trusses 24 in. on center, one piece header to header — designed and stamped by the truss maker" }] : [])]} />
                    </Field>
                  ) : null}
                  {roof.kind === "gable" && roof.ridge?.kind === "beam" && !roof.trusses ? (
                    <Field label="Cross beams under the ridge" aside={roof.crossBeams ? `the ridge spans ${ftIn(roof.ridge.spanIn)} between king posts` : "the ridge spans end to end"} wide>
                      <Seg label="Cross beams under the ridge" value={r.crossBeams} onChange={(v) => rp({ crossBeams: v })} options={[0, 1, 2, 3].map((v) => ({ value: v, label: v === 0 ? "None" : String(v), title: v === 0 ? "The ridge beam spans from one end to the other on king posts" : `${v} cross beam${v > 1 ? "s" : ""} from eave to eave, each with a king post under the ridge and a post under each end` }))} />
                    </Field>
                  ) : null}
                  {roof.kind === "hip" && roof.attach === "free" && roof.ridge?.kind === "beam" ? <p className="v4-hint" data-deck-hip-cross>The ridge beam stands on two king posts, each on a cross beam from eave header to eave header, with a post under each end of the cross beams. Nothing pushes the headers apart, so no ties.</p> : null}
                  {roof.ringTensionLb > 0 ? <p className="v4-hint" data-deck-ring>The hips push the corners out — about {roof.ringTensionLb.toLocaleString("en-US")} lb at each header joint. A tension strap across every joint holds the headers as a ring; they are in the material list.</p> : null}
                  {design.structure === "pergola" && r.pergolaStyle !== "louvered" ? (
                    <div className="v4-grid2">
                      <Field label="Slats">
                        <Seg label="Slats" value={r.slats.size} onChange={(v) => rp({ slats: { ...r.slats, size: v } })} options={(["2x2", "2x4", "2x6"] as const).map((v) => ({ value: v, label: v }))} />
                      </Field>
                      <Field label="Slat spacing" aside="in. apart">
                        <NumberInput label="Slat spacing, inches" value={r.slats.spacingIn} parse={intText} format={String} min={ROOF_LIMITS.slatSpacingIn.min} max={ROOF_LIMITS.slatSpacingIn.max} onCommit={(n2) => rp({ slats: { ...r.slats, spacingIn: n2 } })} />
                      </Field>
                    </div>
                  ) : null}
                  <Field label="Roof load" aside={r.load === "auto" ? `from the site: ${roof.roofLoad} psf` : undefined} wide>
                    <select className="v4-sel" value={String(r.load)} onChange={(e) => rp({ load: e.target.value === "auto" ? "auto" : (Number(e.target.value) as RoofDesign["load"]) })}>
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
                    <div className="v4-sub">
                      <h4 className="v4-h4">Roofing and ceiling</h4>
                      <Field label="Roofing" wide>
                        <Priced
                          ctx={ctx}
                          label="Roofing"
                          value={design.custom.roofing ? null : r.roofing}
                          onPick={(v) => {
                            rp({ roofing: v });
                            dropCustom("roofing");
                          }}
                          options={ROOFINGS.filter((x) => x !== "none").map((x) => ({ value: x, name: ROOFING_LABEL[x], apply: (d: DeckDesign) => applyDeckPatch(d, { roof: { ...d.roof, roofing: x }, custom: { roofing: undefined } }) }))}
                        />
                      </Field>
                      {design.custom.roofing ? (
                        <CustomBox slot="roofing" title="Roofing" product={design.custom.roofing} unit="square" fresh={freshCustom === "roofing"} onDone={freshDone} onChange={(p) => setCustom("roofing", p)} onBack={() => setCustom("roofing", undefined)} note={`Priced per square — 100 sq ft of roof; this roof is ${roof.squares} squares. The underlayment, the flashing and the nails follow what it goes on like.`}>
                          <Field label="Goes on like" wide>
                            <select className="v4-sel" value={r.roofing} onChange={(e) => rp({ roofing: e.target.value as RoofDesign["roofing"] })} data-deck-like="roofing">
                              {roofingOptions}
                            </select>
                          </Field>
                        </CustomBox>
                      ) : (
                        <button type="button" className="v4-link" onClick={() => pickCustom("roofing")} data-deck-pick="roofing">
                          Your own roofing at your price…
                        </button>
                      )}
                      {metalRoof ? (
                        <Field label="Metal goes on" wide>
                          <Seg label="Metal goes on" value={r.roofDeck} onChange={(v) => rp({ roofDeck: v })} options={[{ value: "sheathing", label: "Sheathing" }, { value: "purlins", label: "Purlins" }]} />
                        </Field>
                      ) : null}
                      <Field label="Ceiling" wide>
                        <Priced
                          ctx={ctx}
                          label="Ceiling"
                          cols={3}
                          value={design.custom.ceiling && r.ceiling !== "none" ? null : r.ceiling}
                          onPick={(v) => {
                            rp({ ceiling: v });
                            dropCustom("ceiling");
                          }}
                          options={(["none", "tongue-groove", "beadboard"] as const).map((c) => ({ value: c, name: CEILING_LABEL[c], apply: (d: DeckDesign) => applyDeckPatch(d, { roof: { ...d.roof, ceiling: c }, custom: { ceiling: undefined } }) }))}
                        />
                      </Field>
                      {design.custom.ceiling && r.ceiling !== "none" ? (
                        <CustomBox slot="ceiling" title="Ceiling" product={design.custom.ceiling} unit="sq ft of ceiling" fresh={freshCustom === "ceiling"} onDone={freshDone} onChange={(p) => setCustom("ceiling", p)} onBack={() => setCustom("ceiling", undefined)} note="Priced per square foot of ceiling, 10% waste on top.">
                          <Field label="Looks like" wide>
                            <Seg label="Ceiling looks like" value={r.ceiling} onChange={(v) => rp({ ceiling: v })} options={(["tongue-groove", "beadboard"] as const).map((c) => ({ value: c, label: CEILING_LABEL[c] }))} />
                          </Field>
                        </CustomBox>
                      ) : (
                        <button type="button" className="v4-link" onClick={() => pickCustom("ceiling")} data-deck-pick="ceiling">
                          Your own ceiling at your price…
                        </button>
                      )}
                      {r.kind !== "shed" ? (
                        <PToggle ctx={ctx} checked={r.cupola} onChange={(v) => rp({ cupola: v })} flip={(d) => applyDeckPatch(d, { roof: { ...d.roof, cupola: !d.roof.cupola } })}>
                          Cupola at the peak
                        </PToggle>
                      ) : null}
                    </div>
                    <div className="v4-sub">
                      <h4 className="v4-h4">Fascia, soffit and gutters</h4>
                      <div className="v4-toggles">
                        <PToggle ctx={ctx} checked={r.fascia.eave} onChange={(v) => rp({ fascia: { ...r.fascia, eave: v } })} flip={(d) => applyDeckPatch(d, { roof: { ...d.roof, fascia: { ...d.roof.fascia, eave: !d.roof.fascia.eave } } })}>
                          Fascia on the eaves ({Math.round(roof.eaveFt)} ft)
                        </PToggle>
                        {roof.rakeFt > 0 ? (
                          <PToggle ctx={ctx} checked={r.fascia.rake} onChange={(v) => rp({ fascia: { ...r.fascia, rake: v } })} flip={(d) => applyDeckPatch(d, { roof: { ...d.roof, fascia: { ...d.roof.fascia, rake: !d.roof.fascia.rake } } })}>
                            Rake boards on the gable ends ({Math.round(roof.rakeFt)} ft)
                          </PToggle>
                        ) : null}
                        <PToggle ctx={ctx} checked={r.soffit} onChange={(v) => rp({ soffit: v })} flip={(d) => applyDeckPatch(d, { roof: { ...d.roof, soffit: !d.roof.soffit } })}>
                          Vented soffit under the overhang
                        </PToggle>
                      </div>
                      <Field label="Fascia finish" wide>
                        <select
                          className="v4-sel"
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
                      {design.custom.roofFascia && (r.fascia.eave || r.fascia.rake) ? (
                        <CustomBox slot="roofFascia" title="Fascia finish" product={design.custom.roofFascia} unit="ft" fresh={freshCustom === "roofFascia"} onDone={freshDone} onChange={(p) => setCustom("roofFascia", p)} onBack={() => setCustom("roofFascia", undefined)} note="Priced per foot of fascia and rake board." />
                      ) : null}
                      <Field label="Gutters" aside={roof.gutters ? `${Math.round(roof.gutters.lf)} ft · ${roof.gutters.downspouts} downspouts` : undefined} wide>
                        <Priced
                          ctx={ctx}
                          label="Gutters"
                          cols={2}
                          value={design.custom.gutters && r.gutters.kind !== "none" ? null : r.gutters.kind}
                          onPick={(v) => {
                            rp({ gutters: { ...r.gutters, kind: v } });
                            dropCustom("gutters");
                          }}
                          options={GUTTER_KINDS.map((g) => ({ value: g, name: GUTTER_LABEL[g], apply: (d: DeckDesign) => applyDeckPatch(d, { roof: { ...d.roof, gutters: { ...d.roof.gutters, kind: g } }, custom: { gutters: undefined } }) }))}
                        />
                      </Field>
                      {design.custom.gutters && r.gutters.kind !== "none" ? (
                        <CustomBox slot="gutters" title="Gutters" product={design.custom.gutters} unit="ft of gutter" fresh={freshCustom === "gutters"} onDone={freshDone} onChange={(p) => setCustom("gutters", p)} onBack={() => setCustom("gutters", undefined)} note="Priced per foot of gutter. The downspouts and their elbows stay as the kind it hangs like.">
                          <Field label="Hangs like" wide>
                            <select className="v4-sel" value={r.gutters.kind} onChange={(e) => rp({ gutters: { ...r.gutters, kind: e.target.value as RoofDesign["gutters"]["kind"] } })} data-deck-like="gutters">
                              {GUTTER_KINDS.filter((g) => g !== "none").map((g) => (
                                <option key={g} value={g}>{GUTTER_LABEL[g]}</option>
                              ))}
                            </select>
                          </Field>
                        </CustomBox>
                      ) : (
                        <button type="button" className="v4-link" onClick={() => pickCustom("gutters")} data-deck-pick="gutters">
                          Your own gutters at your price…
                        </button>
                      )}
                      {r.gutters.kind !== "none" ? (
                        <PToggle ctx={ctx} checked={r.gutters.guards} onChange={(v) => rp({ gutters: { ...r.gutters, guards: v } })} flip={(d) => applyDeckPatch(d, { roof: { ...d.roof, gutters: { ...d.roof.gutters, guards: !d.roof.gutters.guards } } })}>
                          Gutter guards
                        </PToggle>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </Section>
            ) : null}

            {withDeck ? (
              <Section id="rails" title="Stairs and railing" summary={extrasSummary} cost={secCost("rails")} open={openSecs.has("rails")} onToggle={() => toggleSec("rails")} step="step-stairs">
                <Field label="Railing" aside={structure.rails.required && design.rail.type === "none" ? "a guard is required here" : undefined} wide>
                  <Priced ctx={ctx} label="Railing" cols={2} value={design.rail.type} onPick={(v) => patch({ rail: { type: v, infill: "auto" } })} options={RAIL_TYPES.map((rt) => ({ value: rt.id, name: rt.id === "none" ? "No railing" : rt.id === "custom" ? "Your own railing" : rt.label, apply: (d: DeckDesign) => applyDeckPatch(d, { rail: { type: rt.id, infill: "auto" } }) }))} />
                </Field>
                {design.rail.type === "custom" ? (
                  <div className="v4-grid2">
                    <Field label="Your railing" wide>
                      <NameInput label="Your railing's name" value={design.rail.customName} placeholder="Brand, line, colour" allowEmpty onCommit={(name) => patch({ rail: { customName: name } })} />
                    </Field>
                    <Field label="Your rail price, installed" aside="$/ft">
                      <NumberInput label="Custom rail price per foot, installed" value={design.rail.customPerFt} parse={intText} format={String} min={0} max={1000} onCommit={(n2) => patch({ rail: { customPerFt: n2 } })} />
                    </Field>
                  </div>
                ) : null}
                <div className="v4-grid2">
                  <Field label="Height">
                    <Seg label="Rail height" value={design.rail.heightIn} onChange={(v) => { touched.current.add("railHeight"); patch({ rail: { heightIn: v } }); }} options={[{ value: 36, label: "36 in." }, { value: 42, label: "42 in." }]} />
                  </Field>
                  {design.rail.type !== "none" ? (
                    <Field label="Infill" aside={design.rail.infill === "auto" ? `picked: ${RAIL_INFILL_LABEL[structure.rails.infill].toLowerCase()}` : undefined}>
                      <select className="v4-sel" value={design.rail.infill} onChange={(e) => patch({ rail: { infill: e.target.value as DeckDesign["rail"]["infill"] } })}>
                        {infills.map((v) => (
                          <option key={v} value={v}>{v === "auto" ? "Auto" : RAIL_INFILL_LABEL[v]}</option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                </div>
                {design.rail.type !== "none" ? (
                  <Field label="Rail posts apart" aside="ft" wide>
                    <Priced ctx={ctx} label="Rail posts apart" cols={3} value={design.rail.postSpacingFt} onPick={(v) => patch({ rail: { postSpacingFt: v } })} options={([4, 6, 8] as const).map((v) => ({ value: v, name: `${v} ft`, apply: (d: DeckDesign) => applyDeckPatch(d, { rail: { postSpacingFt: v } }) }))} />
                  </Field>
                ) : null}
                {design.rail.type !== "none" ? (
                  <div className="v4-toggles">
                    {woodRail ? (
                      <PToggle ctx={ctx} checked={design.rail.cap} onChange={(v) => patch({ rail: { cap: v } })} flip={(d) => applyDeckPatch(d, { rail: { cap: !d.rail.cap } })}>
                        A flat 2x6 drink cap
                      </PToggle>
                    ) : null}
                    {design.lower.on ? (
                      <PToggle ctx={ctx} checked={design.rail.lowerLevel} onChange={(v) => patch({ rail: { lowerLevel: v } })} flip={(d) => applyDeckPatch(d, { rail: { lowerLevel: !d.rail.lowerLevel } })}>
                        Rail on the lower level too
                      </PToggle>
                    ) : null}
                  </div>
                ) : null}
                {structure.rails.on ? <p className="v4-hint">{railWords(structure.rails)}. Lit post caps and step lights are under Lights and outlets.</p> : null}

                <div className="v4-sub" data-deck-stairs>
                  <h4 className="v4-h4">Stairs</h4>
                  <div className="v4-rows">
                    {design.stairs.map((st, i) => {
                      const builtStair = structure.stairs.find((b) => b.design.id === st.id);
                      const sideLen = st.level === "lower" ? (st.side === "front" ? design.lower.widthFt : design.lower.depthFt) : st.side === "front" ? design.shape.widthFt : design.shape.depthFt;
                      return (
                        <Scope key={st.id} stair={st.id}>
                          <div className="v4-card" data-deck-stair={st.id}>
                            <div className="v4-card-head">
                              <span className="v4-card-title">
                                {st.wrap ? "Box steps" : `Stair ${i + 1}`}
                                {builtStair ? ` · ${builtStair.risers} risers of ${builtStair.riserIn.toFixed(2)} in.${builtStair.lands === "lower-deck" ? " to the lower level" : ""}` : ""}
                              </span>
                              <button type="button" className="v4-btn v4-btn--sm v4-btn--danger" onClick={() => setStairs((list) => list.filter((x) => x.id !== st.id))}>
                                Remove
                              </button>
                            </div>
                            <Field label="Down the" wide>
                              <Seg label="Which side" value={st.side} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, side: v, wrap: v === "front" && x.wrap } : x)))} options={(["front", "left", "right"] as const).map((v) => ({ value: v, label: STAIR_SIDE_LABEL[v] }))} />
                            </Field>
                            <div className="v4-grid2">
                              <Field label="Centred at" aside={`ft from the ${st.side === "front" ? "left end" : "house"}`}>
                                <NumberInput label="Where the stair's middle sits along the side, feet" value={st.atFt} parse={parseFeet} format={feetText} min={st.widthFt / 2} max={Math.max(st.widthFt / 2, sideLen - st.widthFt / 2)} onCommit={(n2) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, atFt: n2 } : x)))} />
                              </Field>
                              <Field label="Width" aside="ft">
                                <NumberInput label="Stair width, feet" value={st.widthFt} parse={parseFeet} format={feetText} min={STAIR_LIMITS.widthFt.min} max={STAIR_LIMITS.widthFt.max} onCommit={(n2) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, widthFt: n2 } : x)))} />
                              </Field>
                              <Field label="Lands on">
                                <select className="v4-sel" value={st.landing} onChange={(e) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, landing: e.target.value as StairDesign["landing"] } : x)))}>
                                  {(["pad", "patio", "grade"] as const).map((v) => (
                                    <option key={v} value={v}>{STAIR_LANDING_LABEL[v]}</option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Handrail">
                                <select className="v4-sel" value={st.handrail} onChange={(e) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, handrail: e.target.value as StairDesign["handrail"] } : x)))}>
                                  <option value="auto">Auto — as the code asks</option>
                                  <option value="both">Both sides</option>
                                  <option value="one">One side</option>
                                  <option value="none">None</option>
                                </select>
                              </Field>
                            </div>
                            {design.lower.on ? (
                              <Field label="From" wide>
                                <Seg label="From which level" value={st.level} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, level: v } : x)))} options={[{ value: "upper", label: "The deck" }, { value: "lower", label: "The lower level" }]} />
                              </Field>
                            ) : null}
                            {st.side === "front" ? (
                              <div className="v4-sub-tight">
                                <Toggle checked={st.wrap} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, wrap: v } : x)))}>
                                  Box steps wrapping the deck (three risers at most)
                                </Toggle>
                                {st.wrap ? <Seg label="Wrap how many sides" value={st.wrapSides} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, wrapSides: v } : x)))} options={[{ value: 1, label: "Front" }, { value: 3, label: "Three sides" }, ...(design.placement === "detached" ? [{ value: 4 as const, label: "All four" }] : [])]} /> : null}
                              </div>
                            ) : null}
                          </div>
                        </Scope>
                      );
                    })}
                  </div>
                  <AddPriced
                    ctx={ctx}
                    label="Add stairs"
                    items={[
                      {
                        key: "front",
                        name: "Stairs down the front",
                        disabled: design.stairs.length >= STAIR_LIMITS.count,
                        apply: (d) => applyDeckPatch(d, { stairs: [...d.stairs, defaultStair("v4-probe", "front", d.shape.widthFt / 2)] }),
                        onAdd: () => setStairs((list) => [...list, defaultStair(`s${list.length + 1}-${Date.now().toString(36).slice(-3)}`, "front", design.shape.widthFt / 2)]),
                        data: { "data-deck-add-stair": "" },
                      },
                    ]}
                  />
                  <button
                    type="button"
                    className={cx("v4-btn v4-btn--sm", placing?.kind === "stair" && "is-on")}
                    disabled={design.stairs.length >= STAIR_LIMITS.count}
                    onClick={() => {
                      setPlacing(placing?.kind === "stair" ? null : { kind: "stair" });
                      if (view !== "3d" && view !== "plan") setView("3d");
                      showFigure();
                    }}
                    data-deck-place-stair
                  >
                    {placing?.kind === "stair" ? (view === "plan" ? "Click the plan…" : "Click the deck…") : "Place stairs by clicking the deck"}
                  </button>
                </div>
                <div className="v4-sub" data-deck-extras>
                  <h4 className="v4-h4">The old deck and the hardware</h4>
                  <div className="v4-grid2">
                    <Field label="Tear out an old deck" aside="sq ft">
                      <NumberInput label="Old deck to tear out, square feet" value={design.extras.demoSqFt} parse={intText} format={String} min={0} max={4000} onCommit={(n2) => patch({ extras: { demoSqFt: n2 } })} />
                    </Field>
                  </div>
                  <PToggle ctx={ctx} checked={design.extras.stainless} onChange={(v) => patch({ extras: { stainless: v } })} flip={(d) => applyDeckPatch(d, { extras: { stainless: !d.extras.stainless } })}>
                    Stainless connectors — within 300 ft of salt water
                  </PToggle>
                </div>
              </Section>
            ) : null}

            <Section id="lights" title="Lights, outlets and heaters" summary={electricSummary} cost={secCost("lights")} open={openSecs.has("lights")} onToggle={() => toggleSec("lights")} step="step-electrical">
              <p className="v4-hint">Each goes where it usually does, or Place it in 3D. Wiring, boxes and circuits are priced as electrical work; a fixture the client buys is listed and left to be determined.</p>
              <AddPriced
                ctx={ctx}
                label="Add a light, an outlet or a heater"
                items={FIXTURE_CHIPS.map((k) => ({
                  key: k,
                  name: FIXTURE_SHORT[k],
                  disabled: design.electrical.fixtures.length >= ELECTRICAL_LIMITS.fixtures,
                  apply: (d: DeckDesign) => applyDeckPatch(d, { electrical: { ...d.electrical, fixtures: [...d.electrical.fixtures, defaultFixture(`v4-probe-${k}`, k)] } }),
                  onAdd: () => setFixtures((list) => [...list, defaultFixture(`e${list.length + 1}-${Date.now().toString(36).slice(-3)}`, k)]),
                  data: { "data-deck-add-fixture": k },
                }))}
              />
              <div className="v4-rows">
                {design.electrical.fixtures.map((f) => {
                  const placedOnes = structure.electrical.fixtures.filter((pf) => pf.id === f.id || pf.id.startsWith(`${f.id}-`));
                  return (
                    <Scope key={f.id} fixture={f.id}>
                      <div className="v4-card" data-deck-fixture={f.id}>
                        <div className="v4-card-head">
                          <span className="v4-card-title">
                            {f.custom ? f.custom.name : FIXTURE_SHORT[f.kind]}
                            {f.supply === "client" ? <span className="v4-tbd">by the client · TBD</span> : null}
                          </span>
                          <button type="button" className="v4-btn v4-btn--sm v4-btn--danger" onClick={() => setFixtures((list) => list.filter((x) => x.id !== f.id))}>
                            Remove
                          </button>
                        </div>
                        <div className="v4-grid2">
                          <Field label="What">
                            <select
                              className="v4-sel"
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
                          {f.kind !== "led-strip" && f.kind !== "post-cap" && f.kind !== "step-light" && f.kind !== "string-light" ? (
                            <Field label="How many">
                              <NumberInput label="How many" value={f.qty} parse={intText} format={String} min={1} max={ELECTRICAL_LIMITS.qty.max} onCommit={(n2) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, qty: n2 } : x)))} />
                            </Field>
                          ) : null}
                          <Field label="Who buys the fixture" aside={f.supply === "client" ? "wiring and hanging stay in the price" : undefined} wide>
                            <Seg label="Who buys the fixture" value={f.supply} onChange={(v) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, supply: v } : x)))} options={[{ value: "we", label: "We supply it" }, { value: "client", label: "The client" }]} />
                          </Field>
                          {f.kind === "heater" ? (
                            <Field label="Heater" wide>
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
                              <select className="v4-sel" value={f.kind} onChange={(e) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, kind: e.target.value as FixtureKind, at: null } : x)))} data-deck-like="fixture">
                                {fixtureOptions}
                              </select>
                            </Field>
                          </CustomBox>
                        ) : null}
                        <div className="v4-acts">
                          <button
                            type="button"
                            className={cx("v4-btn v4-btn--sm", placing?.kind === "fixture" && placing.id === f.id && "is-on")}
                            onClick={() => {
                              setPlacing(placing?.kind === "fixture" && placing.id === f.id ? null : { kind: "fixture", id: f.id });
                              setView("3d");
                              showFigure();
                            }}
                            data-deck-place-fixture={f.id}
                          >
                            {placing?.kind === "fixture" && placing.id === f.id ? "Click the 3D…" : f.at ? "Move it in 3D" : "Place in 3D"}
                          </button>
                          {f.at ? (
                            <button type="button" className="v4-btn v4-btn--sm v4-btn--quiet" onClick={() => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, at: null } : x)))}>
                              Back to the usual spot
                            </button>
                          ) : null}
                          <span className="v4-mono">{f.at ? `on the ${f.at.on}` : placedOnes.length ? `${placedOnes.length === 1 ? "placed" : `${placedOnes.length} placed`} where it usually goes` : ""}</span>
                        </div>
                      </div>
                    </Scope>
                  );
                })}
              </div>
              {structure.electrical.on ? (
                <>
                  <div className="v4-grid2">
                    <Field label="Panel to the structure" aside="ft of feed">
                      <NumberInput label="Feet from the house's panel to the structure" value={design.electrical.feedFt} parse={intText} format={String} min={ELECTRICAL_LIMITS.feedFt.min} max={ELECTRICAL_LIMITS.feedFt.max} onCommit={(n2) => patch({ electrical: { ...design.electrical, feedFt: n2 } })} />
                    </Field>
                    <Field label="The feed comes from the">
                      <Seg label="Panel side" value={design.electrical.panelSide} onChange={(v) => patch({ electrical: { ...design.electrical, panelSide: v } })} options={[{ value: "left", label: "Left end" }, { value: "right", label: "Right end" }]} />
                    </Field>
                  </div>
                  <PToggle ctx={ctx} checked={design.electrical.timer} onChange={(v) => patch({ electrical: { ...design.electrical, timer: v } })} flip={(d) => applyDeckPatch(d, { electrical: { ...d.electrical, timer: !d.electrical.timer } })}>
                    A timer or photocell on the lights
                  </PToggle>
                  <p className="v4-hint">
                    {electricalWords(structure.electrical)} · {structure.electrical.boxes} boxes · {structure.electrical.switches} switches
                    {structure.electrical.lv ? ` · ${structure.electrical.lv.transformers} transformer${structure.electrical.lv.transformers > 1 ? "s" : ""}` : ""}
                    {structure.electrical.trenchFt ? ` · ${structure.electrical.trenchFt} ft of trench` : ""}. Turn on Night over the 3D to see them lit.
                  </p>
                </>
              ) : null}
            </Section>
          </FieldScope.Provider>
        </aside>
      </div>

      {topOut ? (
        <div className="v4-bar" role="region" aria-label="Price" data-deck-pricebar>
          <button type="button" className="v4-bar-main" onClick={() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-label={`${money(pkg.subtotal)} — back to the price and the 3D`}>
            <span className="v4-bar-v">{money(pkg.subtotal)}</span>
            <span className="v4-bar-up" aria-hidden="true">↑</span>
          </button>
          <a className={cx("v4-stamp", "v4-bar-stamp", summary.fail ? "v4-stamp--bad" : summary.warn ? "v4-stamp--warn" : "v4-stamp--pass")} href="#v4-issues">
            {summary.fail ? `${summary.fail} to fix` : summary.warn ? `${summary.warn} to check` : "Clean"}
          </a>
          {linked && !linked.lock ? (
            <button type="button" className="v4-btn v4-btn--sm v4-btn--primary" disabled={!!busy || !behind} onClick={askUpdate}>
              {!behind ? "Up to date" : `Update ${linked.ref}`}
            </button>
          ) : (
            <button type="button" className="v4-btn v4-btn--sm v4-btn--primary" disabled={!!busy} onClick={convert}>
              {busy === "convert" ? "Making…" : "Make proposal"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** What it is: the four kinds as pictures the engine drew, each with what switching to it does to the price. */
function KindCards({ ctx, value, onPick }: { ctx: PriceCtx; value: Structure; onPick: (s: Structure) => void }) {
  const prices = React.useMemo(() => STRUCTURES.map((st) => priceOf(ctx, withStructure(ctx.base, st)) - ctx.basePrice), [ctx]);
  return (
    <>
      {STRUCTURES.map((st, i) => {
        const on = st === value;
        return (
          <button key={st} type="button" role="radio" aria-checked={on} className={cx("v4-kind", on && "is-on")} onClick={() => !on && onPick(st)} data-structure={st}>
            <span className="v4-kind-fig" aria-hidden="true">
              <IsoFigure sample={kindSample(st)} detail="thumb" label={STRUCTURE_LABEL[st]} />
            </span>
            <span className="v4-kind-name">{STRUCTURE_LABEL[st]}</span>
            <span className={cx("v4-opt-price", on && "is-on", !on && Math.round(prices[i]) < 0 && "is-less")}>{on ? "In use" : delta(prices[i])}</span>
          </button>
        );
      })}
    </>
  );
}
