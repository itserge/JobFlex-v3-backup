"use client";
// RETIRED 2026-10-18: Variant 1 ("One decision at a time", components/v3/deck-variant-1/deck-v1-studio.tsx) replaced
// this studio on /dashboard/deck-estimator. Kept, unmounted, on purpose — other modules import its sub-components
// (deck-plan, house-wall-plan, deck-kind-picker, deck-photo, deck-coming-soon) and the owner may want it back.
//
// THE DECK ESTIMATOR (2026-10-04; M2 roofs, gazebos, pergolas and the photo
// of the house 2026-10-10; M3 the site, stairs, rails, levels, shaped fronts,
// the electrical, drafts and the part-by-part 3D 2026-10-10) — page CONTENT
// (the shell owns the chrome). Marked Coming soon: only admins reach this
// component (lib/deck/access); everyone else gets deck-coming-soon.tsx.
//
// The steps on the left — What to build, Shape, Height and house (the site),
// Frame, Surface, Roof, Stairs and railing, Lights and outlets, Photo of the
// house — and the structure on the right, standing up in 3D (or as a framing
// plan, or drawn over the photo) with the code-check verdict under it. Every
// change re-frames, re-counts and re-prices in the browser (lib/deck is pure);
// below sit the full code-check strip, the price as the proposal will carry
// it, Good/Better/Best, the material package, and the shop's own prices.
//
// The work saves itself (M3): a draft goes to the server a moment after each
// change and the page can be opened again from the Drafts list or from a
// saved proposal. A touch on any part of the 3D names it; a click flies to
// it; stairs are placed by clicking the plan's edge, fixtures by clicking
// the structure in the 3D.
//
// On a phone (≤768px, in the handheld frame) the same page reads as one
// column: the picture first, then the steps, the price and the lists.

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
  normalizeDeckDesign, SPA_LIMITS } from "@/lib/deck/design";
import { priceDeck, deckNotes, deckScope, type DeckPackage } from "@/lib/deck/pricing";
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
import { HOUSE_LIMITS, HOUSE_ROOF_LABEL, HOUSE_ROOFS, QUICK_WALLS, QUICK_WALL_LABEL, ROOF_COLOURS, SIDINGS, deckShapeForHouse, levelUnderDeck, wallDeckWords, houseForShape, houseNotes, houseWords, nextJogId, quickWall, quickWallOf, stepWords, wallWords, type HouseDesign, type HouseJog, type HouseRoof, wallHighlight, type WallFocus } from "@/lib/deck/house";
import { HouseWallPlan } from "./house-wall-plan";
import { DeckKindPicker } from "./deck-kind-picker";
import { DeckStepRail } from "./deck-step-rail";
import { DeckClientLink } from "./deck-client-link";
import { DECK_LOCK_WORDS, PROPOSAL_STATUS_WORDS, type LinkedDeckProposal } from "@/lib/deck/proposalEdit";
import type { DeckSample } from "@/lib/deck/samples";
import { reportPlanLimitResult } from "@/stores/usePlanLimitStore";
import { autoFixDesign, autoFixable, resizes, roofResizes, settleDesign } from "@/lib/deck/settle";
import type { DeckBackdrop, DeckEdit, DeckPick, SceneHighlight } from "@/components/estimator/deck/DeckModel3D";
import { fieldLight, type FieldFocus } from "@/lib/deck/fieldParts";
import { DeckPlan, type PlanEdgeHit, nearestStairEdge } from "./deck-plan";
import { DeckPhotoView, cropPhoto, shrinkPhoto, straightenPhoto, trimLetterbox } from "./deck-photo";
import s from "./deck-studio.module.css";

const DeckModel3D = dynamic(() => import("@/components/estimator/deck/DeckModel3D").then((m) => m.DeckModel3D), {
  ssr: false,
  loading: () => <div className={s.viewWait}>Setting up the 3D view…</div>,
});

const money = (n: number, cents = false) => `$${n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/** "16", "16.5", "16'6", 16' 6"" → feet. */
function parseFeet(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i.exec(t);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
}
/** Inches; a foot mark reads as feet ("3'" = 36, "3'6" = 42). */
function parseInches(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/['f]/i.test(t)) {
    const ft = parseFeet(t);
    return ft === null ? null : ft * 12;
  }
  const n = Number(t.replace(/("|in)$/i, ""));
  return Number.isFinite(n) ? n : null;
}
const feetText = (ft: number) => {
  const inches = Math.round(ft * 12);
  return inches % 12 === 0 ? String(inches / 12) : `${Math.floor(inches / 12)}'${inches % 12}"`;
};
const intText = (t: string) => (t.trim() === "" ? null : Number(t));
const ago = (iso: string) => {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/* ------------------------------------------------------------------ */
/*  Small controls                                                     */
/* ------------------------------------------------------------------ */

/**
 * WHAT EVERY FIELD IS, IN 3D (owner, 2026-10-12: "highlight all fields to show on 3D what it is — make it smart"): a
 * field knows where it sits — its step, the stair or fixture card it is in, the lower level — and, in or over it, lights
 * what it sets in the 3D (lib/deck/fieldParts). The studio holds the light; a Scope adds where.
 */
interface FieldScopeValue {
  where: Omit<FieldFocus, "label">;
  light: ((f: FieldFocus, how: "focus" | "hover") => void) | null;
  unlight: ((f: FieldFocus, how: "focus" | "hover") => void) | null;
}
const FieldScope = React.createContext<FieldScopeValue>({ where: {}, light: null, unlight: null });
function Scope({ step, stair, fixture, level, children }: { step?: string; stair?: string; fixture?: string; level?: "lower"; children: React.ReactNode }) {
  const parent = React.useContext(FieldScope);
  const value = React.useMemo<FieldScopeValue>(
    () => ({ ...parent, where: { ...parent.where, ...(step ? { step } : {}), ...(stair ? { stair } : {}), ...(fixture ? { fixture } : {}), ...(level ? { level } : {}) } }),
    [parent, step, stair, fixture, level],
  );
  return <FieldScope.Provider value={value}>{children}</FieldScope.Provider>;
}

type Lights = { on: (how: "focus" | "hover") => void; off: (how: "focus" | "hover") => void };
/** A field's (or a tick's) lights: its own, or lit by its label where it sits. */
function useFieldLights(label: string, own?: Lights): Lights | undefined {
  const scope = React.useContext(FieldScope);
  const { light: lightOn, unlight } = scope;
  if (own) return own;
  if (!lightOn || !unlight || !label) return undefined;
  return { on: (how) => lightOn({ ...scope.where, label }, how), off: (how) => unlight({ ...scope.where, label }, how) };
}
/** A label's words, from children that mix words and numbers ("Fascia on the eaves (", 42, " ft)"). */
const wordsOf = (n: React.ReactNode): string => (typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(wordsOf).join("") : "");

/** `lights={null}`: the field lights nothing (the drawing of the wall — working in it, the 3D stays plain). A pointer
 *  that crosses a field with a button held is a drag passing over it, not a look at it: no light. */
function Field({ label, aside, children, wide, lights: own }: { label: string; aside?: React.ReactNode; children: React.ReactNode; wide?: boolean; lights?: Lights | null }) {
  const lit = useFieldLights(label, own ?? undefined);
  const lights = own === null ? undefined : lit;
  return (
    <label
      className={cx(s.field, wide && s.fieldWide)}
      onFocus={lights ? () => lights.on("focus") : undefined}
      onBlur={lights ? () => lights.off("focus") : undefined}
      onMouseEnter={lights ? (e) => { if (!e.buttons) lights.on("hover"); } : undefined}
      onMouseLeave={lights ? () => lights.off("hover") : undefined}
    >
      <span className={s.lbl}>
        <span>{label}</span>
        {aside ? <span className={s.lblAside}>{aside}</span> : null}
      </span>
      {children}
    </label>
  );
}

/** A number typed freely: committed while it is inside its rails, and on leaving the field (held to them). */
function NumberInput({ value, onCommit, parse, format, min, max, label }: { value: number; onCommit: (n: number) => void; parse: (t: string) => number | null; format: (n: number) => string; min: number; max: number; label: string }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <input
      className={cx(s.in, s.num)}
      inputMode="decimal"
      aria-label={label}
      value={draft ?? format(value)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = parse(text);
        if (n !== null && n >= min && n <= max) onCommit(n);
      }}
      onBlur={() => {
        if (draft === null) return;
        const n = parse(draft);
        if (n !== null) onCommit(Math.min(max, Math.max(min, n)));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function Seg<T extends string | number>({ value, options, onChange, label, small }: { value: T; options: ReadonlyArray<{ value: T; label: string; title?: string }>; onChange: (v: T) => void; label: string; small?: boolean }) {
  return (
    <div className={cx(s.seg, small && s.segSmall)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title} className={cx(s.segBtn, o.value === value && s.segOn)} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A price typed with or without the dollar sign and the commas. */
const priceText = (t: string) => {
  const c = t.replace(/[$,\s]/g, "");
  if (c === "") return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
};
const priceShow = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * A name typed freely: committed while it has letters in it, the draft shown until the field is left (so the spaces
 * survive the typing). An emptied field keeps the last name unless `allowEmpty`. `focusNow` puts the cursor in it, the
 * text selected, so a product picked a moment ago is typed over.
 */
function NameInput({ value, onCommit, label, placeholder, allowEmpty, focusNow, onDone }: { value: string; onCommit: (v: string) => void; label: string; placeholder?: string; allowEmpty?: boolean; focusNow?: boolean; onDone?: () => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!focusNow || !ref.current) return;
    ref.current.focus({ preventScroll: true });
    ref.current.select();
  }, [focusNow]);
  return (
    <input
      ref={ref}
      className={s.in}
      aria-label={label}
      placeholder={placeholder}
      maxLength={CUSTOM_LIMITS.name}
      value={draft ?? value}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const clean = text.replace(/\s+/g, " ").trim();
        if (clean || allowEmpty) onCommit(clean);
      }}
      onBlur={() => {
        setDraft(null);
        onDone?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** The last choice on every material list (owner, 2026-10-12: "always an option custom in case the contractor didn't find it"). */
const CUSTOM = "__custom";
const CUSTOM_LABEL = "Custom — type your own…";

/**
 * A product the list doesn't carry: its name and the shop's price for it, in the list's unit. `children` say what it is
 * built like — the engine still frames, spaces and wires it as that, so the code checks keep working.
 */
function CustomBox({ slot, title, product, unit, onChange, onBack, children, note, fresh, onDone }: { slot: string; title: string; product: CustomProduct; unit: string | null; onChange: (p: CustomProduct) => void; onBack: () => void; children?: React.ReactNode; note?: React.ReactNode; fresh?: boolean; onDone?: () => void }) {
  return (
    <div className={s.customBox} data-deck-custom={slot}>
      <div className={s.customHead}>
        <span className={s.customTag}>Your own · {title}</span>
        <button type="button" className={cx(s.btn, s.btnSm, s.btnGhost)} onClick={onBack} data-deck-custom-back={slot}>
          Back to the list
        </button>
      </div>
      <div className={s.customGrid}>
        <Field label="Product" wide={!unit}>
          <NameInput label={`${title}: your product's name`} value={product.name} placeholder="Brand, line, size" focusNow={fresh} onDone={onDone} onCommit={(name) => onChange({ ...product, name })} />
        </Field>
        {unit ? (
          <Field label="Your price" aside={`$ per ${unit}`}>
            <NumberInput label={`${title}: your price per ${unit}`} value={product.price} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.price.min} max={CUSTOM_LIMITS.price.max} onCommit={(price) => onChange({ ...product, price })} />
          </Field>
        ) : null}
        {children}
      </div>
      {note ? <p className={s.hint}>{note}</p> : null}
    </div>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  const lights = useFieldLights(wordsOf(children).trim());
  return (
    <label
      className={s.toggle}
      onFocus={lights ? () => lights.on("focus") : undefined}
      onBlur={lights ? () => lights.off("focus") : undefined}
      onMouseEnter={lights ? (e) => { if (!e.buttons) lights.on("hover"); } : undefined}
      onMouseLeave={lights ? () => lights.off("hover") : undefined}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={s.toggleBox} aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

/**
 * The steps' colours (owner, 2026-10-11: "each step accented differently … less black"): one hue per step, around the
 * wheel from the blueprint's blue — blue, teal, green, amber, terracotta, rose, plum, violet, indigo — all at the same
 * depth, so the number, the rail, the summary and the chosen controls of a step share its colour and no step is black.
 */
const STEP_HUES: ReadonlyArray<[hue: number, sat: number, light: number]> = [[212, 52, 42], [188, 48, 36], [158, 42, 36], [36, 72, 38], [18, 60, 42], [348, 52, 44], [300, 38, 40], [262, 44, 46], [232, 48, 48], [200, 24, 40]];
function stepTone(n: number): React.CSSProperties {
  const [h, sat, light] = STEP_HUES[(Math.max(1, n) - 1) % STEP_HUES.length];
  return { "--step-c": `hsl(${h} ${sat}% ${light}%)`, "--step-ink": "#fff", "--step-soft": `hsl(${h} ${sat}% 96%)` } as React.CSSProperties;
}

/** The photo of the house is out (owner, 2026-10-11: "let's not use that picture at all — the 3D model, and you draw the house"); its flow stays here, dormant. */
const PHOTO_ENABLED = false;

/**
 * EDIT IN 3D BREATHES (owner, 2026-10-12: "make the Edit in 3D button slowly blink, to attract the contractor"; then "I
 * don't see the Edit in 3D button blinking" — it had stopped for good once tried): a slow breath whenever the 3D edit is
 * off, every visit; still while editing.
 */

function Step({ n, title, summary, children, id }: { n: number; title: string; summary: string; children: React.ReactNode; id?: string }) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const nextRef = React.useRef<HTMLButtonElement>(null);
  const nextTitleRef = React.useRef<HTMLSpanElement>(null);
  // THE WAY DOWN (owner, 2026-10-11: "friendly and easy to use"): each step ends with the next one's name. It is read
  // off the page after every render, so the steps that come and go (the house, the footprint) need no list of their own.
  React.useEffect(() => {
    const nxt = ref.current?.nextElementSibling;
    const title2 = nxt instanceof HTMLElement && nxt.matches("details[data-step]") ? nxt.querySelector("[data-step-title]")?.textContent ?? null : null;
    if (nextRef.current) nextRef.current.hidden = !title2;
    if (nextTitleRef.current) nextTitleRef.current.textContent = title2 ?? "";
  });
  const goNext = (e: React.MouseEvent<HTMLButtonElement>) => {
    const nxt = e.currentTarget.closest("details")?.nextElementSibling;
    if (!(nxt instanceof HTMLDetailsElement)) return;
    nxt.open = true;
    const calm = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nxt.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    nxt.querySelector("summary")?.focus({ preventScroll: true });
  };
  return (
    <details className={s.step} open id={id} style={stepTone(n)} data-step={n} ref={ref}>
      <summary className={s.stepHead}>
        <span className={s.stepN}>{n}</span>
        <span className={s.stepTitle} data-step-title>{title}</span>
        <span className={s.stepSum}>{summary}</span>
      </summary>
      <div className={s.stepBody}>
        <Scope step={id ?? title}>{children}</Scope>
        <div className={s.stepFoot}>
          <button ref={nextRef} type="button" className={s.stepNext} style={stepTone(n + 1)} onClick={goNext} hidden data-step-next>
            Next: <span ref={nextTitleRef} /> <span aria-hidden="true">↓</span>
          </button>
        </div>
      </div>
    </details>
  );
}

const LEVEL_LABEL: Record<DeckCheck["level"], string> = { fail: "Fix", warn: "Check", info: "Note", pass: "Pass" };

/* ------------------------------------------------------------------ */
/*  The studio                                                         */
/* ------------------------------------------------------------------ */

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
  { id: "good", name: "Good", decking: (st) => treatedDecking(st), rail: "treated", words: "Treated wood boards and rail — the working deck." },
  { id: "better", name: "Better", decking: () => "composite-better", rail: "composite", words: "Capped composite boards and a composite rail — no staining, ever." },
  { id: "best", name: "Best", decking: () => "composite-best", rail: "aluminum", words: "Premium composite and an aluminum rail — the thin profile, the long warranty." },
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

export function DeckStudio({ initialBook, homeState, initialAddress, clientId, adminPreview = false, opened = null }: { initialBook: DeckRateBook; homeState: string | null; initialAddress?: string; clientId?: string; adminPreview?: boolean; opened?: OpenedDesign | null }) {
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

  // SETTLING (owner, 2026-10-10: "when I change the sizes, make sure it reads the codes and rebuilds the material —
  // beams, support, everything"): a size change re-runs the tables (lib/deck/settle) and applies the member-sizing
  // fixes the checks would offer, so what stands on screen is never a frame the tables refuse. The fixes' labels show
  // under the verdict until the next resize.
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
        // picked in the Shape step puts its step in the wall; a rectangle takes that step away.
        if (p.house) {
          const fit = deckShapeForHouse(next.shape, next.house);
          if (JSON.stringify(fit.shape) !== JSON.stringify(next.shape)) next = applyDeckPatch(next, { shape: fit.shape });
        } else if (p.shape) {
          // A deck sized anew keeps the wall's steps where they are and takes its notch from them; a notch picked by
          // hand (the size unchanged) puts its own step in the wall.
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
  // THE PRICE BAR (2026-10-12, "polish — easy to use"): on a phone or a tablet the viewer sits above the steps, so once it
  // scrolls away the price and the checks ride along at the bottom, with a tap back up to the deck.
  const viewerRef = React.useRef<HTMLElement>(null);
  /** The steps' column: the step rail reads its steps off it. */
  const stepsRef = React.useRef<HTMLDivElement>(null);
  /** The material package's groups that are open (2026-10-12: they start folded, their subtotals in view). */
  const [bomOpen, setBomOpen] = React.useState<ReadonlySet<BomStep>>(() => new Set());
  const toggleBom = (step: BomStep) =>
    setBomOpen((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  const [viewerOut, setViewerOut] = React.useState(false);
  React.useEffect(() => {
    const el = viewerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setViewerOut(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
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
  // A SAMPLE TO START FROM (owner, 2026-10-11, lib/deck/samples): the sample's kind, shape, height, rails, stairs, levels
  // and roof laid over the contractor's own address, site, house and lumber, settled to the tables like any resize. The
  // card stays marked "In use" exactly as long as the design is the one the sample made.
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
  // AUTO-FIX (owner, 2026-10-11: "offer fixes or auto fix"): every failure's fix and the warnings the code answers, in
  // one tap (lib/deck/settle autoFixDesign); what was done and what is left for a person is said under the header.
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
  // THE WALL FIELD, SHOWN IN 3D (owner, 2026-10-12: "when I click a box to type in, show in the 3D which one it is —
  // make it smart"): the field being typed in — or, failing that, the one the pointer is over — lights its part of the
  // house (lib/deck/house wallHighlight): the wall past an end of the deck, a step, the stretch of wall a step moves.
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
  // WORKING IN THE SHAPE IS QUIET (owner, 2026-10-12: "don't show in blue on 3D when working in the shape"): the
  // drawing of the wall lights nothing, and a press in it puts out whatever light is still on. A box typed in a moment
  // ago would keep its light through the drag — the drawing holds the pointer and keeps the focus where it was — so it
  // is let go of first (its number is committed on the way out).
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
      // deck as drawn IS the tier — boards and railing (2026-10-12: a deck with no railing read as the railed Good tier).
      const railT = design.rail.type === "none" && !structure.rails.required ? "none" : t.rail;
      const variant = applyDeckPatch(design, { decking: { product: t.decking(st) }, rail: { type: railT }, custom: { decking: undefined } });
      const p = priceDeck(variant, { rates: book, market });
      return { ...t, product: t.decking(st), subtotal: p.subtotal, perSqFt: p.pricePerSqFt, current: !design.custom.decking && design.decking.product === t.decking(st) && design.rail.type === railT };
    });
  }, [design, book, market, homeState, withDeck, structure.rails.required]);

  /* ── the 3D's build-up, night, connections, picking ── */
  const [view, setView] = React.useState<"3d" | "plan" | "wall" | "photo">("3d");
  // THE DRAWING, LARGE (owner, 2026-10-11: "more space for drawing"): the House step's wall-and-deck drawing in the viewer.
  const openWallLarge = React.useCallback(() => {
    setView("wall");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1100px)").matches) document.querySelector("[data-deck-viewer]")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `polygon` is derived from `design` below; the latest design is what matters.
    [design, patch, rp, setStairs, setHouse],
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
        // A click anywhere on the deck takes its nearest open edge (owner, 2026-10-11: "on the 3D, click anywhere to add steps").
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
  // THE PROPOSAL IT WAS OPENED FROM (owner, 2026-10-12: "when a deck design proposal is saved, make an option to open
  // and edit the design"): the proposal's drawing card opens the studio on it, and "Update the proposal" re-prices
  // that one (actions/deckEstimator updateDeckProposal) rather than making a second. The draft remembers it too.
  const [linked, setLinked] = React.useState<LinkedDeckProposal | null>(opened?.proposal ?? null);
  const linkedId = linked?.id ?? null;
  const designSig = React.useMemo(() => JSON.stringify([design, address]), [design, address]);
  /** The design the proposal holds, as a signature; null when not known (a draft opened later may hold changes). */
  const [proposalSig, setProposalSig] = React.useState<string | null>(() => (opened?.from === "proposal" ? designSig : null));
  const [updated, setUpdated] = React.useState<{ at: string; kept: number; titleKept: boolean; scopeKept: boolean } | null>(null);
  const [confirmAt, setConfirmAt] = React.useState<"top" | "bottom" | null>(null);
  /** Where the last proposal action was asked from: its error shows there. */
  const [actAt, setActAt] = React.useState<"top" | "bottom">("bottom");
  /** The design differs from the one on the proposal. */
  const behind = !!linked && designSig !== proposalSig;
  // THE CLIENT'S RETURN (owner, 2026-10-13: "show that it came back in the studio, with a flash, while you're
  // designing somebody else"): the design on screen may be one a client sent back (its words ride over it), and
  // the studio asks every half minute for returns nobody has opened yet — those bloom at the top until opened.
  const [fromClient, setFromClient] = React.useState<ReturnedClientDesign | null>(opened?.client ?? null);
  const clientToken = fromClient?.token ?? null;
  const [inbox, setInbox] = React.useState<Array<ClientLinkRow & { url: string }>>([]);
  // "Later" puts a return aside in this browser until it is sent again (the key carries the send's time).
  const LATER_KEY = "jf-deck-later";
  // Read once at mount; nothing of it is in the server's markup (the inbox arrives after), so no mismatch.
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
  React.useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      try {
        localStorage.setItem("jf-deck-draft", JSON.stringify({ design, address, at: Date.now() }));
      } catch {
        /* the server copy is the one that counts */
      }
      const res = await saveDeckDraft({ id: draftId, title: draftTitle || null, design, address, proposalId: linkedId, clientToken });
      if (res.ok) {
        setDraftId(res.id);
        setSavedAt(res.updatedAt);
        setSaveState("saved");
      } else setSaveState("failed");
    }, 1500);
    return () => clearTimeout(t);
  }, [design, address, draftId, draftTitle, linkedId, clientToken]);
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
    setConfirmAt(null);
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
    setConfirmAt(null);
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

  /* ── the photo of the house ── */
  const [photoHref, setPhotoHref] = React.useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const pickPhoto = () => fileRef.current?.click();
  /** What the studio is doing with the picture right now, for the buttons. */
  const [photoStage, setPhotoStage] = React.useState<string | null>(null);
  /** The read's own trouble (no key, no wall seen): the picture still goes up, placed by hand. */
  const [photoNote, setPhotoNote] = React.useState<string | null>(null);
  /** The last picture chosen, so "Fit to the wall" can read it again at full size. */
  const lastFile = React.useRef<File | null>(null);
  const fitDeck = React.useMemo<FitDeck>(() => ({ shape: design.shape, depthFt: design.shape.depthFt, elevWidthFt: elevation.widthFt, elevHeightFt: elevation.heightFt, elevLeftFt: elevation.leftFt }), [design.shape, elevation]);
  // THE SMART FIT (owner, 2026-10-10): the picture is shrunk, its black bands
  // cut, read once by the vision model (actions readDeckPhoto), cropped to
  // the wall and placed by the read (lib/deck/photoFit) — then saved. A read
  // that fails still saves the picture, centred, and says why.
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
        // AN ANGLED SHOT IS STRAIGHTENED ON ITS OWN (owner, 2026-10-11: "the windows are kind of spread around"): the
        // wall's corners from the read make the warp (lib/deck/photoFit autoRectify); the picture as taken, cut to its
        // wall, is kept too, so "Original picture" can bring it back.
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
  /** The model's read again — on the picture as chosen when it is still here, else on the saved one. */
  const readPhotoAgain = async () => {
    if (!design.photo || photoBusy) return;
    let file = lastFile.current;
    if (!file) {
      const href = photoHref ?? (await deckPhotoHref(design.photo.url).catch(() => null));
      if (!href) return;
      try {
        const blob = await fetch(href).then((r) => (r.ok ? r.blob() : null));
        if (!blob) return;
        file = new File([blob], "house.jpg", { type: blob.type || "image/jpeg" });
      } catch {
        return;
      }
    }
    await placePhoto(file);
  };
  /** The fit again, from the read the picture carries — no second look by the model. */
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
  /** The house's step taken into the deck's shape — then the deck is set on it again once the new shape's elevation is in. */
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
  // A design that already holds a photo (a reopened estimate) needs its read link.
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
  // THE PHOTO AS THE WALL in the 3D (owner, 2026-10-10): the same picture, placement and scale the photo view uses.
  // On the house (a ledger, or a roof on the wall) it IS the wall; a detached gazebo keeps it as a backdrop a yard back.
  const [showHouse, setShowHouse] = React.useState(true);
  const backdrop = React.useMemo<DeckBackdrop | null>(() => {
    const p = design.photo;
    if (!PHOTO_ENABLED || !showHouse || !p?.placed || !photoHref) return null;
    return { href: photoHref, w: p.w, h: p.h, placed: p.placed, elevWidthFt: elevation.widthFt, elevLeftFt: elevation.leftFt, jogs: (p.fit?.read?.jogs ?? []).map((j) => ({ x: j.x, dir: j.dir, depthFt: j.depthFt })), standoffFt: scene.house ? 0 : 16, wall: p.fit?.read ? wallExtent(p.fit.read) : null };
  }, [design.photo, photoHref, elevation.widthFt, elevation.leftFt, showHouse, scene.house]);
  // MARK THE WALL (owner, 2026-10-10: "start drawing the lines right on that picture — the house wall where the deck
  // is supposed to be — kind of measures"): the read's base, door, measure and steps as handles on the picture; every
  // change fits the deck again, from the marks, with no model.
  const [marking, setMarking] = React.useState(false);
  const markRead: WallRead = design.photo?.fit?.read ?? blankRead();
  const applyRead = (read: WallRead) => {
    const p = design.photo;
    if (!p) return;
    const marked = markedRead(read);
    const fit = fitPhoto(marked, fitDeck, design.heightIn, p.w, p.h, { recrop: false, fallback: p.placed ?? defaultPlacement(), hand: true });
    patch({ photo: { ...p, placed: fit.placed, fit: fitSummary(fit, marked, true) } });
  };
  // STRAIGHTEN THE PICTURE (owner, 2026-10-11: an angled shot of the house "still can't work and build the deck with
  // this pic"): four corners put on the wall, and the picture is warped so the wall stands square — then the read,
  // the fit and the 3D take it as any square-on photo (lib/deck/photoFit rectifyPlan). The picture before is kept
  // in the design, so it can be undone.
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
      const blob = href ? await fetch(href).then((r) => (r.ok ? r.blob() : null)).catch(() => null) : null;
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
  /** Back to the picture as it was taken, with its own placement and read. */
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
  // A reopened design with a photo needs a fresh read link.
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
  /** Re-price the proposal it was opened from with this design; the studio stays open on it. */
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
    <div className={cx(s.call, s.callWarn, s.confirm)} role="alertdialog" aria-label="Update a proposal the client has" data-deck-update-confirm>
      <p>
        <b>The client already has this proposal{linked.status === "VIEWED" ? " and has opened it" : ""}.</b> Updating it changes the price and the 3D on their link.
      </p>
      <div className={s.rowActs}>
        <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} onClick={() => void update()} data-deck-update-yes>
          Update it
        </button>
        <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => setConfirmAt(null)}>
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
  const r = design.roof;
  const structureSummary = `${what}${withRoof && design.structure !== "covered-deck" ? ` · ${FLOOR_LABEL[design.floor].toLowerCase()}` : ""}`;
  const shapeSummary = `${sizeWords(design)} · ${Math.round(pkg.areaSqFt)} sq ft`;
  const heightSummary = withDeck ? `${design.heightIn >= 24 ? ftIn(design.heightIn) : `${design.heightIn} in.`} · ${design.placement === "attached" ? "ledger" : design.placement === "beside" ? "own posts" : "free-standing"}${structure.gradePct >= 2 ? ` · ${structure.gradePct}% fall` : ""}` : `${design.loadPsf} psf · ${design.soilPsf.toLocaleString("en-US")} psf soil · frost ${design.frostIn} in.`;
  const frameSummary = frame ? `${frame.joistSize} @ ${frame.spacingIn}" · ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")} ${frame.beamStyle === "flush" ? "flush" : "beam"}` : "";
  const surfaceSummary = frame ? `${frame.decking.label}${design.decking.pattern !== "straight" ? ` · ${design.decking.pattern}` : ""}${design.decking.border ? " · border" : ""}` : "";
  const roofSummary = roof ? roofWords(roof) : "";
  const extrasSummary = [structure.rails.on ? railWords(structure.rails).split(" — ")[0] : null, structure.stairs.length ? `${structure.stairs.length} ${structure.stairs.length === 1 ? "stair" : "stairs"}` : null].filter(Boolean).join(" · ") || "None yet";
  const electricSummary = structure.electrical.on ? electricalWords(structure.electrical) : "None";
  const photoSummary = design.photo ? (design.photo.fit && !design.photo.fit.notes[0]?.startsWith("The wall could not") ? ("Fitted to the wall") : design.photo.placed ? "Placed on the photo" : "Photo added — place it") : "No photo yet";

  const bomByStep = React.useMemo(() => {
    const out = new Map<BomStep, typeof pkg.bom>();
    for (const l of pkg.bom) out.set(l.step, [...(out.get(l.step) ?? []), l]);
    return out;
  }, [pkg]);

  // ── PRODUCTS OF THE SHOP'S OWN (2026-10-12, owner: "always an option custom in case the contractor didn't find it
  // from what we have"). Every material list ends with Custom: the list's choice stays as what it is built like, and the
  // typed name and price stand in for it on the material list and the proposal (lib/deck/takeoff, lib/deck/pricing).
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
  // THE BOARD LIST (2026-10-12, owner: "the most popular materials, brands for decking, and what is most popular per
  // state"): the boards most used in the job's region first (lib/deck/regional), then the woods, the brands' own lines,
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
  const roofingOptions = ROOFINGS.filter((x) => x !== "none").map((x) => (
    <option key={x} value={x}>{ROOFING_LABEL[x]}</option>
  ));
  const fixtureOptions = FIXTURE_KINDS.map((k) => (
    <option key={k} value={k}>{FIXTURE_LABEL[k]}</option>
  ));
  const freshDone = () => setFreshCustom(null);

  const issues = checks.filter((c) => c.level === "fail" || c.level === "warn");
  const ordered = [...checks].sort((a, b) => ["fail", "warn", "info", "pass"].indexOf(a.level) - ["fail", "warn", "info", "pass"].indexOf(b.level));
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
    <li key={c.id} className={cx(s.check, s[`level_${c.level}`])} data-check={c.id}>
      <span className={s.checkLevel}>{LEVEL_LABEL[c.level]}</span>
      <div className={s.checkBody}>
        <div className={s.checkText}>
          <b>{c.part}.</b> {c.text}
        </div>
        {c.rule ? <div className={s.checkRule}>{c.rule}</div> : null}
      </div>
      {c.fix || c.alts?.length ? (
        <div className={s.checkFixes}>
          {c.fix ? (
            <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => patch(c.fix!.patch)} data-check-fix="primary">
              {c.fix.label}
            </button>
          ) : null}
          {(c.alts ?? []).map((a) => (
            <button key={a.label} type="button" className={cx(s.btn, s.btnSm, s.btnGhost)} onClick={() => patch(a.patch)} data-check-fix="alt">
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );

  // Step numbers follow what is shown.
  let n = 0;
  const next = () => ++n;
  const kinds = KINDS_FOR[design.structure];
  const polygon = r.plan.shape === "hexagon" || r.plan.shape === "octagon" || r.plan.shape === "round";
  const planShapes: RoofPlanShape[] = design.structure === "pergola" ? (withDeck ? ["follows-deck", "square", "rect"] : ["square", "rect"]) : design.structure === "covered-deck" ? ["follows-deck", "square", "rect"] : withDeck ? ["follows-deck", "square", "rect", "hexagon", "octagon", "round"] : ["square", "rect", "hexagon", "octagon", "round"];
  const canAttach = (withDeck ? design.placement !== "detached" : true) && !polygon && r.kind !== "pyramid" && r.kind !== "double-tier" && r.kind !== "gambrel" && r.kind !== "dutch-gable" && r.kind !== "pergola";
  // The roof's outline and size — in the Roof step over a deck; the "Footprint" step for a gazebo or pergola on its own floor.
  const outlineBlock = (
    <>
      <Field label="Outline" wide>
        <Seg small label="Roof outline" value={r.plan.shape} onChange={(sh: RoofPlanShape) => rp({ plan: { ...r.plan, shape: sh } })} options={planShapes.map((sh) => ({ value: sh, label: ROOF_PLAN_LABEL[sh] }))} />
      </Field>
      {r.plan.shape !== "follows-deck" ? (
        <div className={s.grid2}>
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
        <p className={s.hint}>{Math.round(roof.footprintSqFt)} sq ft under the eaves · {roof.posts.length} posts{roof.attach === "wall" ? " and the house wall" : ""}{roof.kind !== "pergola" ? ` · ${Math.round(roof.roofAreaSqFt)} sq ft of roof, ${roof.squares} squares` : ""}{roof.engineered ? " · engineered beam where the sawn tables stop" : ""}</p>
      ) : null}
    </>
  );
  const metalRoof = r.roofing === "metal-panel" || r.roofing === "standing-seam";
  const front = design.shape.kind === "rect" ? design.shape.front : undefined;
  const woodRail = design.rail.type === "treated" || design.rail.type === "cedar";
  const infills = design.rail.type === "cable" ? (["auto", "cable"] as const) : design.rail.type === "glass" ? (["auto", "glass"] as const) : design.rail.type === "aluminum" ? (["auto", "balusters", "cable", "glass", "horizontal"] as const) : woodRail ? (["auto", "balusters", "horizontal"] as const) : (["auto", "balusters", "panel"] as const);
  const placingFixture = placing?.kind === "fixture" ? design.electrical.fixtures.find((f) => f.id === placing.id) : null;

  return (
    <div className={s.studio}>
      <div className={s.pageHead}>
        <div>
          <div className={s.kicker}>Automation · Estimating</div>
          <h1 className={s.pageTitle}>Deck estimator</h1>
          {adminPreview ? (
            <div className={s.previewNote}>
              <span className={cx(s.stamp, s.stampWarn)}>Coming soon</span>
              <span>Customers without the Deck Studio plan see its offer here. You can work and test it because you are an admin.</span>
            </div>
          ) : null}
          <p className={s.pageSub}>Pick what to build and size it: it frames itself to the code, stands up in 3D, prices every line and saves as you go.</p>
        </div>
      </div>

      {/* A client's design came back while you were here (2026-10-13): it blooms until opened or put aside. */}
      {inboxNew.length ? (
        <section className={cx(s.card, s.inbox)} aria-live="polite" aria-label="Designs sent back by clients" data-deck-inbox={inboxNew.length}>
          {inboxNew.slice(0, 3).map((l) => (
            <div key={l.token} className={s.inboxRow} data-deck-inbox-row={l.token}>
              <span className={s.inboxDot} aria-hidden="true" />
              <div className={s.inboxText}>
                <b>{l.clientName}</b> sent back a deck design{l.sentAt ? <span className={s.inboxWhen}> · {ago(l.sentAt)}</span> : null}
                <span className={s.inboxJob}>for {jobLine(l)}</span>
                {/* What she designed — unless the job's name already says it (an untitled link is named by the design). */}
                {l.words && (l.proposal || l.words !== l.title) ? <span className={s.inboxWords}>{l.words}</span> : null}
                {l.note ? <span className={s.inboxNote}>“{l.note.length > 120 ? `${l.note.slice(0, 120)}…` : l.note}”</span> : null}
              </div>
              <div className={s.rowActs}>
                {l.draftId ? (
                  <a className={cx(s.btn, s.btnSm, s.btnPrimary)} href={`/dashboard/deck-estimator?draft=${l.draftId}` as Route} data-deck-inbox-open>
                    Open it
                  </a>
                ) : null}
                <button type="button" className={cx(s.btn, s.btnSm, s.btnGhost)} onClick={() => putAside(l)} aria-label={`Put ${l.clientName}'s design aside until they send again`} title="Put it aside — it comes back when they send again; the count in Client designs stays">
                  Later
                </button>
              </div>
            </div>
          ))}
          {inboxNew.length > 3 ? <div className={s.inboxMore}>and {inboxNew.length - 3} more in Client designs</div> : null}
        </section>
      ) : null}

      {/* The client's words over the design they sent back (2026-10-13). */}
      {fromClient ? (
        <section className={cx(s.card, s.fromClient)} aria-label="What the client sent" data-deck-from-client>
          <div className={s.linkedText}>
            <div className={s.linkedKicker}>{fromClient.name}&apos;s design{fromClient.sends > 1 ? ` · sent ${fromClient.sends} times` : ""}{fromClient.sentAt ? ` · ${ago(fromClient.sentAt)}` : ""}</div>
            {!linked ? <div className={s.linkedTitle}><span className={s.linkedName}>{fromClient.title}</span>{fromClient.address ? <span className={s.mono}>{fromClient.address}</span> : null}</div> : null}
            <p className={s.linkedSub}>
              {fromClient.note ? <>“{fromClient.note}” </> : <>No note with it. </>}
              {fromClient.unsure.includes("height") ? <b>Not sure of the height — measure it on site. </b> : null}
              {linked ? "Price it, then update the proposal below." : "Price it, then convert it to a proposal — the client's link follows it."}
            </p>
          </div>
          <div className={s.linkedActs}>
            {fromClient.phone ? <a className={cx(s.btn, s.btnSm)} href={`tel:${fromClient.phone}`}>Call {fromClient.name.split(/\s+/)[0]}</a> : null}
            <a className={cx(s.btn, s.btnSm, s.btnGhost)} href={fromClient.url} target="_blank" rel="noopener">Their page ↗</a>
          </div>
        </section>
      ) : null}

      {/* The proposal this design is on (2026-10-12): what it holds, and the one button that brings it up to date. */}
      {linked ? (
        <section className={cx(s.card, s.linkedBar)} aria-label="The proposal this design is on" data-deck-linked={linked.lock ? "locked" : behind ? "behind" : "even"}>
          <div className={s.linkedText}>
            <div className={s.linkedKicker}>Editing the deck of a saved proposal</div>
            <div className={s.linkedTitle}>
              <span className={s.linkedRef}>{linked.ref}</span>
              <span className={s.linkedName}>{linked.title}</span>
              <span className={cx(s.stamp, linked.lock ? s.stampWarn : linked.seen ? s.stampInfo : s.stampPass)} data-deck-linked-status>{PROPOSAL_STATUS_WORDS[linked.status] ?? linked.status}</span>
            </div>
            <p className={s.linkedSub}>
              {linked.lock
                ? `This proposal is ${DECK_LOCK_WORDS[linked.lock]}, so its price stays as it is — a new design goes on a new proposal.`
                : behind
                  ? updated
                    ? "Changed since the last update — the proposal still has the earlier design."
                    : "Your changes save here as a draft. The proposal keeps its price until you update it."
                  : updated
                    ? `Updated ${ago(updated.at)} — the proposal has this design.${updatedWords ? ` ${updatedWords}` : ""}`
                    : "The proposal has this design. Change it here, then update the proposal."}
            </p>
          </div>
          <div className={s.linkedActs}>
            <a className={cx(s.btn, s.btnSm)} href={`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}`} data-deck-linked-back>
              Back to the proposal
            </a>
            {!linked.lock && behind ? (
              <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} disabled={!!busy} onClick={() => askUpdate("top")} data-deck-update="top">
                {busy === "update" ? "Updating…" : "Update the proposal"}
              </button>
            ) : null}
          </div>
          {confirmAt === "top" ? confirmBox : null}
          {error && actAt === "top" ? (
            <p className={cx(s.call, s.callBad, s.linkedNote)} role="alert">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* The job: where it is decides the lumber, the frost line, the snow, the market's prices. */}
      <section className={cx(s.card, s.jobBar)} aria-label="Job">
        <form
          className={s.addrForm}
          onSubmit={(e) => {
            e.preventDefault();
            commitAddress(addressDraft);
          }}
        >
          <Field label="Job address" aside={<span>{site.label}{` · frost ${design.frostIn} in. · snow ${design.site.groundSnowPsf} psf`}</span>} wide>
            <input className={s.in} value={addressDraft} placeholder="Street, city, state ZIP" autoComplete="street-address" onChange={(e) => setAddressDraft(e.target.value)} onBlur={() => addressDraft.trim() !== address && commitAddress(addressDraft)} />
          </Field>
        </form>
        <div className={s.jobFacts}>
          <span className={s.mono}>{(frame ?? roof)?.species.region} lumber: {(frame ?? roof)?.species.short}</span>
          {exampleShare > 0 ? <span className={cx(s.stamp, s.stampWarn)}>{exampleShare}% example prices</span> : <span className={cx(s.stamp, s.stampPass)}>Your prices</span>}
          {pkg.storeShare > 0 ? <span className={cx(s.stamp, s.stampPass)} title={`Materials at ${STORE_SURVEY.store}'s listed prices, surveyed once (${STORE_SURVEY.asOf}) — your own prices win`} data-deck-store-share>Materials: {STORE_SURVEY.store}, {new Date(STORE_SURVEY.asOf + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span> : null}
          <div className={s.draftBar} data-deck-drafts>
            <span className={s.draftState} data-deck-save={saveState}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" && savedAt ? `${linked ? "Draft saved" : "Saved"} ${ago(savedAt)}` : saveState === "failed" ? "Not saved — will retry" : linked ? `Opened from ${linked.ref}` : "Saves as you go"}
            </span>
            <details className={s.drafts} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void refreshDrafts()}>
              <summary className={cx(s.btn, s.btnSm)}>Drafts</summary>
              <div className={s.draftList}>
                <div className={s.draftRow}>
                  <input className={cx(s.in)} value={draftTitle} placeholder={structureWords(design)} aria-label="Name this draft" onChange={(e) => { dirty.current = true; setDraftTitle(e.target.value); }} />
                  <button type="button" className={cx(s.btn, s.btnSm, s.btnGhost)} onClick={startFresh}>New</button>
                </div>
                {drafts === null ? <div className={s.draftEmpty}>Reading…</div> : drafts.length === 0 ? <div className={s.draftEmpty}>No saved drafts yet. The one you are working on appears here a moment after your first change.</div> : null}
                {(drafts ?? []).map((d) => (
                  <div key={d.id} className={s.draftRow} data-deck-draft={d.id}>
                    <div>
                      <div className={s.draftName}>{d.title}{d.id === draftId ? " · open" : ""}</div>
                      <div className={s.draftMeta}>{ago(d.updatedAt)}{d.fromClient ? ` · from ${d.fromClient}` : ""}{d.proposalId ? " · changes to a saved proposal" : ""}{d.address ? ` · ${d.address}` : ""}{d.by && !d.fromClient ? ` · ${d.by}` : ""}</div>
                    </div>
                    <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => void openDraft(d.id)} disabled={d.id === draftId}>Open</button>
                    <button type="button" className={cx(s.btn, s.btnSm, s.btnDanger)} onClick={() => void removeDraft(d.id)} aria-label={`Delete the draft ${d.title}`}>×</button>
                  </div>
                ))}
              </div>
            </details>
            {/* The client designs it (2026-10-11): a link to their own page, no prices; it comes back as a draft. */}
            <DeckClientLink design={design} address={address} title={draftTitle.trim()} clientId={clientId} proposalId={linkedId} unseen={inbox.length} onOpened={(token) => setInbox((list) => list.filter((l) => l.token !== token))} />
          </div>
        </div>
      </section>

      <div className={s.layout}>
        {/* ── the structure ─────────────────────────────────────── */}
        <section ref={viewerRef} className={cx(s.card, s.viewer)} aria-label={`The ${what.toLowerCase()}`} data-deck-viewer>
          <div className={s.viewHead}>
            <div className={s.viewTitle}>
              <span className={s.cardTitle}>The {what.toLowerCase()}</span>
              <span className={s.mono}>{scene.facts}</span>
            </div>
            <Seg small label="View" value={view} onChange={setView} options={PHOTO_ENABLED ? [{ value: "3d" as const, label: "3D" }, { value: "plan" as const, label: "Framing plan" }, { value: "wall" as const, label: "House & deck" }, { value: "photo" as const, label: "Photo" }] : [{ value: "3d" as const, label: "3D" }, { value: "plan" as const, label: "Framing plan" }, { value: "wall" as const, label: "House & deck" }]} />
          </div>
          <div className={cx(s.viewBox, view === "wall" && s.viewBoxWall)}>
            {view === "wall" ? (
              <div className={cx(s.planWrap, s.wallWrap)} onPointerDownCapture={quiet} data-deck-wall-large-view>
                <HouseWallPlan size="large" shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} />
              </div>
            ) : view === "3d" ? (
              <>
                <DeckModel3D scene={scene} built={built} xray={xray} backdrop={backdrop} night={night} connections={connections} placing={placing?.kind === "fixture" || placing?.kind === "stair"} edit={editing} onEdit={onEdit} resetToken={resetToken} focus={focus} onPick={onPick} highlight={wallLit ?? fieldLit} className={s.canvas} label={`The ${what.toLowerCase()} in 3D: ${scene.facts}`} />
                {editing && !placing ? (
                  <div className={s.placeBanner} data-deck-editing>
                    <span>Drag the blue knobs: the deck&apos;s width, depth and height, the roof&apos;s height and its pitch at the peak, the lower level, each stair along its edge and its width at its side, the house&apos;s two corners and every step in its wall. Everything re-frames and re-prices as you drag.</span>
                    <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => setEditing(false)}>Done</button>
                  </div>
                ) : null}
                {hoverPick?.legend && !placing ? (
                  <div className={s.pickTag} data-deck-hover>
                    <b>{hoverPick.legend.role}{hoverPick.legend.nominal ? ` · ${hoverPick.legend.nominal}` : ""}{hoverPick.legend.lengthFt ? ` · ${ftIn(hoverPick.legend.lengthFt * 12)}` : ""}</b>
                    {hoverPick.legend.note.split(/(?<=\.)\s/)[0]} {hoverPick.layer !== null ? <span className={s.mono}>click to zoom</span> : null}
                  </div>
                ) : null}
                {placing?.kind === "stair" ? (
                  <div className={s.placeBanner} data-deck-placing="stair-3d">
                    <span>Click the deck where the stairs go — they take the nearest open edge, on whichever level you click.</span>
                    <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => setPlacing(null)}>Cancel</button>
                  </div>
                ) : null}
                {placingFixture ? (
                  <div className={s.placeBanner} data-deck-placing="fixture">
                    <span>Click on the {what.toLowerCase()} where the {FIXTURE_SHORT[placingFixture.kind].toLowerCase()} goes — a post, a header, the rail, the ceiling, the house wall.</span>
                    <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => setPlacing(null)}>Cancel</button>
                  </div>
                ) : null}
              </>
            ) : view === "plan" ? (
              <div className={s.planWrap}>
                <DeckPlan structure={structure} placing={placing?.kind === "stair" ? "stair" : null} onPlaceStair={placeStair} />
                {placing?.kind === "stair" ? (
                  <div className={s.placeBanner} data-deck-placing="stair">
                    <span>Click an open edge of the deck where the stairs go.</span>
                    <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => setPlacing(null)}>Cancel</button>
                  </div>
                ) : null}
              </div>
            ) : design.photo ? (
              <DeckPhotoView photo={design.photo} href={photoHref} elevation={elevation} onPlace={(placed) => patch({ photo: { ...design.photo!, placed } })} onRefresh={refreshPhoto} marking={marking} read={marking ? markRead : (design.photo.fit?.read ?? null)} onRead={applyRead} corners={straightening ? corners : null} onCorners={setCorners} />
            ) : (
              <div className={s.photoEmpty} data-deck-photo="empty">
                <p>Take a picture of the back of the house from the yard, square on. The {what.toLowerCase()} is drawn over it, and the client sees their own house with it in place.</p>
                <button type="button" className={cx(s.btn, s.btnPrimary)} onClick={pickPhoto} disabled={photoBusy}>
                  {photoBusy ? (photoStage ?? "Saving the picture…") : "Add a photo of the house"}
                </button>
                {photoError ? <p className={cx(s.call, s.callBad)} role="alert">{photoError}</p> : null}
              </div>
            )}
          </div>
          {view === "3d" ? (
            <>
              <div className={s.buildRow}>
                <button type="button" className={cx(s.btn, s.btnSm, playing && s.btnOn)} onClick={() => (playing ? setPlaying(false) : play())}>
                  {playing ? "Pause" : "Build it"}
                </button>
                <label className={s.buildSlider}>
                  <span className={s.mono}>{layerNow}</span>
                  <input type="range" min={0} max={LAYERS} step={0.01} value={sliderValue} aria-label="How much is standing" onChange={(e) => { setPlaying(false); setBuilt(Number(e.target.value)); }} />
                </label>
                <button type="button" className={cx(s.btn, s.btnSm, xray && s.btnOn)} aria-pressed={xray} onClick={() => setXray((x) => !x)}>
                  X-ray
                </button>
                {structure.frame ? (
                  <button type="button" className={cx(s.btn, s.btnSm, placing?.kind === "stair" && s.btnOn)} aria-pressed={placing?.kind === "stair"} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => setPlacing(placing?.kind === "stair" ? null : { kind: "stair" })} data-deck-3d-add-stair>
                    {placing?.kind === "stair" ? "Click the deck…" : "+ Stairs"}
                  </button>
                ) : null}
                {PHOTO_ENABLED && design.photo?.placed ? (
                  <button type="button" className={cx(s.btn, s.btnSm, showHouse && s.btnOn)} aria-pressed={showHouse} onClick={() => setShowHouse((v) => !v)} data-deck-house-toggle>
                    House photo
                  </button>
                ) : null}
                <button type="button" className={cx(s.btn, s.btnSm, connections && s.btnOn)} aria-pressed={connections} onClick={() => setConnections((c) => !c)} data-deck-connections>
                  Connections
                </button>
                <button type="button" className={cx(s.btn, s.btnSm, night && s.btnOn)} aria-pressed={night} onClick={() => setNight((x) => !x)} data-deck-night>
                  Night
                </button>
                <button
                  type="button"
                  className={cx(s.btn, s.btnSm, editing && s.btnOn, !editing && s.btnBreath)}
                  aria-pressed={editing}
                  title="Drag the deck, the stairs and the house's walls right in the 3D"
                  onClick={() => setEditing((x) => !x)}
                  data-deck-edit
                  data-deck-edit-breathing={!editing ? "" : undefined}
                >
                  Edit in 3D
                </button>
                <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => { setResetToken((t) => t + 1); setPicked(null); }}>
                  Reset view
                </button>
              </div>
              {picked ? (
                <div className={s.pickCard} data-deck-picked>
                  <div className={s.pickHead}>
                    {picked.legend.role}
                    <span>{picked.legend.nominal}{picked.legend.lengthFt ? ` · ${ftIn(picked.legend.lengthFt * 12)}` : ""}{picked.legend.count > 1 ? ` · ${picked.legend.count} of them` : ""}</span>
                  </div>
                  <div className={s.pickBody}>{picked.legend.note}</div>
                  <div className={s.pickActs}>
                    <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => setFocus([...picked.point] as [number, number, number])}>Zoom</button>
                    <button type="button" className={cx(s.btn, s.btnSm, s.btnGhost)} onClick={() => setPicked(null)}>Close</button>
                  </div>
                </div>
              ) : connections ? (
                <div className={s.pickCard}>
                  <div className={s.pickBody}>Numbered tags mark the connections: click one to read how it is made and fly to it. Click any part — a joist, a hanger, a rafter, a bolt — to name it.</div>
                </div>
              ) : null}
            </>
          ) : PHOTO_ENABLED && view === "photo" && design.photo ? (
            <>
              <div className={s.photoRow}>
                <span className={s.mono}>{design.photo.fit ? "Fitted to the wall — drag to adjust, pull the handle to size · the client sees it placed like this" : "Drag the outline to the wall · pull the handle to size it · the client sees it placed like this"}</span>
                <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} onClick={refitPhoto} disabled={photoBusy} data-deck-photo-refit>{photoBusy ? (photoStage ?? "Working…") : "Fit to the wall"}</button>
                <button type="button" className={cx(s.btn, s.btnSm, marking && s.btnOn)} aria-pressed={marking} onClick={() => { setStraightening(false); setCorners(null); setMarking((m) => !m); }} data-deck-photo-mark>{marking ? "Marking the wall" : "Mark the wall"}</button>
                <button type="button" className={cx(s.btn, s.btnSm, straightening && s.btnOn)} aria-pressed={straightening} onClick={() => (straightening ? cancelStraighten() : startStraighten())} disabled={photoBusy} data-deck-photo-straighten>{straightening ? "Straightening" : "Straighten the picture"}</button>
                {design.photo.straightened ? (
                  <button type="button" className={cx(s.btn, s.btnSm)} onClick={unstraighten} disabled={photoBusy} data-deck-photo-unstraighten>Original picture</button>
                ) : null}
                {design.photo.fit?.read ? <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => void readPhotoAgain()} disabled={photoBusy} data-deck-photo-reread>Read the picture again</button> : null}
                {design.photo.fit?.offer ? (
                  <button type="button" className={cx(s.btn, s.btnSm)} onClick={applyOffer} data-deck-photo-offer>
                    {design.photo.fit.offer.kind === "notch" ? "Notch the deck around the step" : `Fit the deck into the ${design.photo.fit.offer.widthFt} ft recess`}
                  </button>
                ) : null}
                {heightOffer !== null ? (
                  <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => patch({ heightIn: heightOffer })} data-deck-photo-height>Use {heightOffer} in. height</button>
                ) : null}
                <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => patch({ photo: { ...design.photo!, placed: defaultPlacement() } })}>Centre it</button>
                <button type="button" className={cx(s.btn, s.btnSm)} onClick={pickPhoto} disabled={photoBusy}>Another photo</button>
                <button type="button" className={cx(s.btn, s.btnSm)} onClick={removePhoto}>Remove</button>
              </div>
              {straightening ? (
                <div className={s.photoTools} data-deck-photo-straighten-tools>
                  <span className={s.mono}>Drag the four white corners onto the wall — where it meets the ground at the left and the right, and the top of the wall above each. The picture is then warped so the wall stands square: an angled shot becomes a true elevation.</span>
                  <label className={s.markField}>
                    <span className={s.mono}>The wall between the corners is</span>
                    <NumberInput label="Width of the wall between the corners, feet" value={wallWidthFt ?? 0} parse={parseFeet} format={(n2) => (n2 > 0 ? feetText(n2) : "")} min={0} max={200} onCommit={(n2) => setWallWidthFt(n2 > 0 ? n2 : null)} />
                    <span className={s.mono}>ft wide — optional, it sets the exact width</span>
                  </label>
                  <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} onClick={() => void straightenNow()} disabled={photoBusy} data-deck-photo-straighten-go>{photoBusy ? (photoStage ?? "Working…") : "Straighten it"}</button>
                  <button type="button" className={cx(s.btn, s.btnSm)} onClick={cancelStraighten} disabled={photoBusy}>Cancel</button>
                </div>
              ) : null}
              {marking ? (
                <div className={s.photoTools} data-deck-photo-tools>
                  <span className={s.mono}>Drag the yellow ends to where the wall meets the ground · the door&apos;s bottom to its threshold, its top to the frame · a step where the wall jogs · a measure along anything you know the size of</span>
                  {markRead.door ? (
                    <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => applyRead(removeDoor(markRead))} data-deck-mark-door="remove">Remove the door</button>
                  ) : (
                    <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => applyRead(addDoor(markRead, design.photo!.w, design.photo!.h))} data-deck-mark-door="add">Add the door</button>
                  )}
                  {markRead.scaleLine ? (
                    <>
                      <label className={s.markField}>
                        <span className={s.mono}>The measure is</span>
                        <NumberInput label="Length of the measure, inches" value={markRead.scaleLine.lengthIn} parse={parseInches} format={(n2) => String(Math.round(n2))} min={6} max={600} onCommit={(n2) => applyRead(setScaleLength(markRead, n2))} />
                        <span className={s.mono}>in.</span>
                      </label>
                      <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => applyRead(removeScaleLine(markRead))} data-deck-mark-measure="remove">Remove the measure</button>
                    </>
                  ) : (
                    <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => applyRead(addScaleLine(markRead))} data-deck-mark-measure="add">Add a measure</button>
                  )}
                  <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => applyRead(addJog(markRead))} disabled={markRead.jogs.length >= 4} data-deck-mark-step="add">Add a step</button>
                  {markRead.jogs.map((j, i) => (
                    <span key={i} className={s.markField} data-deck-mark-jog={i}>
                      <span className={s.mono}>step {i + 1} · the part to its right</span>
                      <Seg small label={`Step ${i + 1} goes`} value={j.dir} onChange={(dir: "toward" | "away") => applyRead(setJog(markRead, i, { dir }))} options={[{ value: "toward", label: "comes out" }, { value: "away", label: "steps back" }]} />
                      <NumberInput label={`Step ${i + 1} depth, feet`} value={j.depthFt ?? 2} parse={parseFeet} format={feetText} min={0.5} max={40} onCommit={(n2) => applyRead(setJog(markRead, i, { depthFt: n2 }))} />
                      <span className={s.mono}>ft</span>
                      <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => applyRead(removeJog(markRead, i))} aria-label={`Remove step ${i + 1}`}>×</button>
                    </span>
                  ))}
                  <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} onClick={() => setMarking(false)} data-deck-mark-done>Done</button>
                </div>
              ) : null}
              {design.photo.fit?.notes.length || photoNote ? (
                <ul className={s.photoNotes} data-deck-photo-fit aria-label="What the picture showed">
                  {photoNote ? <li className={s.photoNoteBad}>{photoNote}</li> : null}
                  {(design.photo.fit?.notes ?? []).map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              ) : null}
            </>
          ) : null}
          <input ref={fileRef} className={s.fileHidden} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Photo of the house" onChange={(e) => void onPhotoFile(e.target.files?.[0] ?? null)} />
          <a className={s.verdict} href="#deck-checks">
            {summary.fail ? <span className={cx(s.stamp, s.stampBad)}>{summary.fail} to fix</span> : <span className={cx(s.stamp, s.stampPass)}>Inside the tables</span>}
            {summary.warn ? <span className={cx(s.stamp, s.stampWarn)}>{summary.warn} to check</span> : null}
            <span className={s.verdictText}>{issues[0] ? `${issues[0].part}: ${issues[0].text}` : `${summary.pass} checks pass — every number names its table.`}</span>
            <span className={s.verdictTotal}>{money(pkg.subtotal)}</span>
          </a>
          {autoNotes.length ? (
            <p className={s.autoNote} role="status" data-deck-autofix>
              Re-sized to the tables: {autoNotes.join(" · ")}.
            </p>
          ) : null}
        </section>

        {/* ── the steps ──────────────────────────────────────────── */}
        <FieldScope.Provider value={rootScope}>
        <div className={s.steps} ref={stepsRef}>
          <DeckStepRail stepsRef={stepsRef} />
          <Step n={next()} title="What to build" summary={structureSummary} id="step-structure">
            {/* THE KINDS AS PICTURES (owner, 2026-10-11): the engine's own drawings of each kind, and samples to start from (deck-kind-picker). */}
            <DeckKindPicker structure={design.structure} onPickKind={setStructure} onPickSample={applySample} appliedSampleId={applied && applied.design === design ? applied.id : null} />
            {/* WHERE IT STANDS (owner, 2026-10-10): from the very start, a plain site or the house's own wall from a photo — out since 2026-10-11, the house is drawn. */}
            {PHOTO_ENABLED ? (
            <Field label="Where it stands" wide>
              <div className={s.chips} role="group" aria-label="Where it stands">
                <button type="button" className={cx(s.chip, !design.photo && s.chipOn)} aria-pressed={!design.photo} onClick={() => { if (design.photo) removePhoto(); }} data-deck-site="plain">
                  A plain site<span>the drawn house</span>
                </button>
                <button type="button" className={cx(s.chip, !!design.photo && s.chipOn)} aria-pressed={!!design.photo} onClick={() => (design.photo ? setView("photo") : pickPhoto())} disabled={photoBusy} data-deck-site="photo">
                  {design.photo ? "The photo of the house" : "A photo of the house"}<span>{design.photo ? `${design.photo.straightened ? "straightened · " : ""}${design.photo.fit?.hand ? "marked by hand" : design.photo.fit ? "fitted to the wall" : "placed by hand"}` : photoBusy ? (photoStage ?? "working…") : "upload one — the wall is read off it"}</span>
                </button>
              </div>
              <p className={s.hint}>With a photo the wall, the door and its steps are read off the picture — or marked by hand — and the {what.toLowerCase()} is set against the real wall, in the 3D too. A gazebo that stands on its own keeps the house behind it.</p>
            </Field>
            ) : null}
            {design.structure === "gazebo" || design.structure === "pergola" ? (
              <Field label="It stands" wide>
                <Seg small label="It stands" value={design.floor} onChange={(f: Floor) => patch({ floor: f })} options={(["deck", "slab", "ground"] as const).map((f) => ({ value: f, label: FLOOR_LABEL[f] }))} />
              </Field>
            ) : null}
            {!withDeck ? <p className={s.hint}>{design.floor === "slab" ? "A new 4-in. slab a foot wider than the posts goes in the price; the posts sit on anchored bases." : "Each post gets its own poured footing, sized for what it carries."}</p> : null}
          </Step>

          {/* THE HOUSE (owner, 2026-10-11): drawn, not photographed — storeys, the roof, and the back wall's steps the deck fits itself to. */}
          {scene.house ? (
            <Step n={next()} title="The house" summary={houseWords(design.house)} id="step-house">
              <p className={s.hint}>Drawn for the look of the {what.toLowerCase()}: drag any part of the back wall in or out, tap + for a step, and size the {what.toLowerCase()} by its ends and front edge. The boxes keep the exact inches.</p>
              <div className={s.rowGrid}>
                <Field label="Storeys">
                  <Seg small label="Storeys" value={String(design.house.storeys)} onChange={(v) => setHouse({ storeys: v === "2" ? 2 : 1 })} options={[{ value: "1", label: "One" }, { value: "2", label: "Two" }]} />
                </Field>
                <Field label="Roof">
                  <Seg small label="Roof" value={design.house.roof} onChange={(v: HouseRoof) => setHouse({ roof: v })} options={HOUSE_ROOFS.map((r) => ({ value: r, label: HOUSE_ROOF_LABEL[r] }))} />
                </Field>
              </div>
              <Field label="The back wall and the deck, seen from above — drag anything" wide lights={null}>
                <div className={s.quiet} onPointerDownCapture={quiet} data-deck-wall-quiet>
                  <HouseWallPlan shape={design.shape} house={design.house} onChange={(n2) => patch({ ...(n2.shape ? { shape: n2.shape } : {}), ...(n2.house ? { house: n2.house } : {}) })} onOpenLarge={openWallLarge} />
                </div>
              </Field>
              <div className={s.rowGrid}>
                <Field label="Siding">
                  <div className={s.chips} role="group" aria-label="Siding">
                    {SIDINGS.map((c) => (
                      <button key={c.id} type="button" className={cx(s.chip, s.swatchChip, design.house.siding === c.id && s.chipOn)} aria-pressed={design.house.siding === c.id} onClick={() => setHouse({ siding: c.id })} data-deck-house-siding={c.id}>
                        <span className={s.swatch} style={{ background: c.hex }} aria-hidden />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Roof colour">
                  <div className={s.chips} role="group" aria-label="Roof colour">
                    {ROOF_COLOURS.map((c) => (
                      <button key={c.id} type="button" className={cx(s.chip, s.swatchChip, design.house.roofColour === c.id && s.chipOn)} aria-pressed={design.house.roofColour === c.id} onClick={() => setHouse({ roofColour: c.id })} data-deck-house-roof-colour={c.id}>
                        <span className={s.swatch} style={{ background: c.hex }} aria-hidden />
                        {c.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <p className={houseNotes(design.shape, design.house).length ? cx(s.call, s.callBad) : s.hint} data-deck-wall-words>{wallWords(design.shape, design.house)}</p>
              <Field label="The wall's shape" wide>
                <div className={s.chips} role="group" aria-label="The wall's shape">
                  {QUICK_WALLS.map((k) => (
                    <button key={k} type="button" className={cx(s.chip, quickWallOf(design.shape, design.house) === k && s.chipOn)} aria-pressed={quickWallOf(design.shape, design.house) === k} onClick={() => setHouse(quickWall(k, design.shape, design.house))} data-deck-wall-quick={k}>
                      {QUICK_WALL_LABEL[k]}
                    </button>
                  ))}
                </div>
              </Field>
              <div className={s.rowGrid}>
                <Field label="Wall past the deck's left end" aside="ft" lights={lightsFor({ kind: "left" })}>
                  <NumberInput label="Wall past the left end, feet" value={design.house.leftFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ leftFt: n2 })} />
                </Field>
                <Field label="Wall past the deck's right end" aside="ft" lights={lightsFor({ kind: "right" })}>
                  <NumberInput label="Wall past the right end, feet" value={design.house.rightFt} parse={parseFeet} format={feetText} min={HOUSE_LIMITS.extendFt.min} max={HOUSE_LIMITS.extendFt.max} onCommit={(n2) => setHouse({ rightFt: n2 })} />
                </Field>
              </div>
              <div className={s.rows} data-deck-house-jogs>
                {design.house.jogs.map((j, i) => (
                  <div key={j.id} className={s.row} data-deck-house-jog={j.id}>
                    <div className={s.rowHead}>
                      <span className={s.rowTitle}>Step {i + 1} — {stepWords(j, design.shape)}</span>
                      <button type="button" className={cx(s.btn, s.btnSm, s.btnDanger)} onClick={() => setHouse({ jogs: design.house.jogs.filter((x) => x.id !== j.id) })} data-deck-house-jog-remove>Remove</button>
                    </div>
                    <div className={s.rowGrid}>
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
              <button type="button" className={cx(s.btn, s.btnSm)} disabled={design.house.jogs.length >= HOUSE_LIMITS.jogs} onClick={() => setHouse({ jogs: [...design.house.jogs, { id: nextJogId(design.house.jogs), atFt: Math.max(2, design.shape.widthFt - 4), dir: "toward", depthFt: 3 }] })} data-deck-house-add-jog>
                + Add a step in the wall
              </button>
            </Step>
          ) : null}

          {!withDeck ? (
            <Step n={next()} title={design.structure === "pergola" ? "The pergola's footprint" : "The gazebo's footprint"} summary={sizeWords(design)} id="step-footprint">
              {outlineBlock}
            </Step>
          ) : null}

          {withDeck ? (
            <Step n={next()} title={design.structure === "gazebo" || design.structure === "pergola" ? "The deck under it" : "Shape"} summary={shapeSummary} id="step-shape">
              <Seg
                label="Shape"
                value={design.shape.kind}
                onChange={(k) => {
                  if (k === design.shape.kind || k === "wall") return;
                  // A rectangle asked for while the deck follows the wall: the wall under it goes straight, and the deck with it.
                  if (k === "rect" && design.shape.kind === "wall") return patch({ house: levelUnderDeck(design.house, design.shape) });
                  patch({ shape: k === "rect" ? { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt } : { kind: "L", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, notch: { corner: "front-right", widthFt: Math.max(2, Math.round(design.shape.widthFt / 2)), depthFt: Math.max(2, Math.round(design.shape.depthFt / 2)) } } });
                }}
                options={[{ value: "rect", label: "Rectangle" }, { value: "L", label: "L-shaped" }, ...(design.shape.kind === "wall" ? [{ value: "wall" as const, label: "Follows the wall" }] : [])]}
              />
              <div className={s.grid2}>
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
                  <div className={s.grid2}>
                    <Field label="Cut along the house" aside="ft">
                      <NumberInput label="Corner cut along the house, feet" value={design.shape.notch.widthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.widthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, widthFt: n2 } } })} />
                    </Field>
                    <Field label="Cut out from the house" aside="ft">
                      <NumberInput label="Corner cut out from the house, feet" value={design.shape.notch.depthFt} parse={parseFeet} format={feetText} min={2} max={design.shape.depthFt - 3} onCommit={(n2) => design.shape.kind === "L" && patch({ shape: { ...design.shape, notch: { ...design.shape.notch, depthFt: n2 } } })} />
                    </Field>
                  </div>
                  <p className={s.hint}>A back corner is where the house steps out into the deck — a bump-out or a bay.</p>
                </>
              ) : (
                <>
                  {design.shape.kind === "wall" ? (
                    <div className={s.sub} data-deck-follows-wall>
                      <p className={s.hint}>
                        <b>The back follows the house wall</b> — {wallDeckWords(design.shape)}. It reaches into a set-back, its ledger on that wall, and steps around a bump-out. Move the wall in The house step and the deck follows.
                      </p>
                      <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => patch({ house: levelUnderDeck(design.house, design.shape) })} data-deck-straighten-wall>
                        Straighten the wall under the deck
                      </button>
                    </div>
                  ) : (
                  <Field label="The front edge" wide>
                    <Seg small label="The front edge" value={front?.kind ?? "straight"} onChange={(k: FrontKind) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: k === "straight" ? undefined : { kind: k, bulgeFt: front?.bulgeFt ?? 2, clipFt: front?.clipFt ?? 2 } } })} options={(["straight", "curve", "clipped"] as const).map((k) => ({ value: k, label: FRONT_LABEL[k] }))} />
                  </Field>
                  )}
                  {front?.kind === "curve" ? (
                    <Field label="The bow at the middle" aside="ft · laminated rim, joists cut to the arc" wide>
                      <NumberInput label="How far the front bows out at the middle, feet" value={front.bulgeFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.bulgeFt.min} max={Math.min(DECK_LIMITS.bulgeFt.max, design.shape.widthFt / 3)} onCommit={(n2) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: { ...front, bulgeFt: n2 } } })} />
                    </Field>
                  ) : front?.kind === "clipped" ? (
                    <Field label="Each corner clipped" aside="ft at 45°" wide>
                      <NumberInput label="How much each front corner is clipped, feet" value={front.clipFt} parse={parseFeet} format={feetText} min={DECK_LIMITS.clipFt.min} max={Math.min(DECK_LIMITS.clipFt.max, (design.shape.widthFt - 2) / 2, design.shape.depthFt - 2)} onCommit={(n2) => patch({ shape: { kind: "rect", widthFt: design.shape.widthFt, depthFt: design.shape.depthFt, front: { ...front, clipFt: n2 } } })} />
                    </Field>
                  ) : null}
                  <div className={s.sub}>
                    <Toggle checked={design.lower.on} onChange={(v) => patch({ lower: { on: v } })}>A lower level in front, a step down</Toggle>
                    {design.lower.on ? (
                      <Scope level="lower">
                        <div className={s.grid2}>
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
                        <p className={s.hint}>One riser (up to 7¾ in.) is a step the lower deck itself makes; more than that wants a stair between the levels — the checks offer one.</p>
                      </Scope>
                    ) : null}
                  </div>
                  {design.shape.kind === "rect" || design.shape.kind === "wall" ? (
                    <div className={s.sub}>
                      <Toggle checked={design.spa.on} onChange={(v) => patch({ spa: { on: v } })}>A hot-tub spot — the frame under it doubled</Toggle>
                      {design.spa.on ? (
                        <>
                          <div className={s.grid2}>
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
                          <p className={s.hint}>Every joist under the tub is doubled and the checks read the frame at the filled weight (≈100 psf). The tub itself is by others — its pad drawing governs.</p>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </Step>
          ) : null}

          <Step n={next()} title={withDeck ? "Height, house and ground" : "Site"} summary={heightSummary} id="step-site">
            {withDeck ? (
              <>
                <Field label="How it meets the house" wide>
                  <Seg small label="How it meets the house" value={design.placement} onChange={(p: Placement) => patch({ placement: p })} options={(["attached", "beside", "detached"] as const).map((p) => ({ value: p, label: PLACEMENT_LABEL[p].split(" — ")[0] }))} />
                </Field>
                {design.placement !== "detached" ? (
                  <Field label="The house wall there" wide>
                    <select className={s.sel} value={design.wall} onChange={(e) => patch({ wall: e.target.value as DeckDesign["wall"] })}>
                      {WALL_TYPES.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.label}
                          {w.ledger ? "" : " — no ledger"}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                {design.placement !== "detached" && !wall.ledger ? <p className={cx(s.hint, s.hintWarn)}>{wall.why}</p> : null}
                <div className={s.grid2}>
                  <Field label="Deck height" aside={`in. · ${ftIn(design.heightIn)}`}>
                    <NumberInput label="Height of the deck surface above the ground, inches" value={design.heightIn} parse={parseInches} format={(n2) => String(Math.round(n2 * 4) / 4)} min={DECK_LIMITS.heightIn.min} max={DECK_LIMITS.heightIn.max} onCommit={(n2) => patch({ heightIn: n2 })} />
                  </Field>
                  <Field label="Frost depth" aside="in.">
                    <NumberInput label="Frost depth, inches" value={design.frostIn} parse={intText} format={String} min={0} max={96} onCommit={(n2) => patch({ frostIn: n2 }, ["frost"])} />
                  </Field>
                </div>
                <div className={s.chips}>
                  {HEIGHT_PRESETS.map((h) => (
                    <button key={h.label} type="button" className={cx(s.chip, design.heightIn === h.inches && s.chipOn)} onClick={() => patch({ heightIn: h.inches })}>
                      {h.label} <span>{ftIn(h.inches)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={s.grid2}>
                <Field label="Frost depth" aside="in.">
                  <NumberInput label="Frost depth, inches" value={design.frostIn} parse={intText} format={String} min={0} max={96} onCommit={(n2) => patch({ frostIn: n2 }, ["frost"])} />
                </Field>
                <Field label="Footings stand above grade" aside="in.">
                  <NumberInput label="Top of the footings above the ground, inches" value={design.footing.aboveGradeIn} parse={intText} format={String} min={DECK_LIMITS.aboveGradeIn.min} max={DECK_LIMITS.aboveGradeIn.max} onCommit={(n2) => patch({ footing: { aboveGradeIn: n2 } })} />
                </Field>
              </div>
            )}
            <div className={s.grid2}>
              <Field label="Design load" aside={design.site.groundSnowPsf > 40 ? `snow here ${design.site.groundSnowPsf} psf` : "live or snow"}>
                <select className={s.sel} value={design.loadPsf} onChange={(e) => patch({ loadPsf: Number(e.target.value) as LoadPsf }, ["load"])}>
                  {LOADS.map((l) => (
                    <option key={l} value={l}>
                      {l === 40 ? "40 psf — live load" : `${l} psf ground snow`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Soil bears">
                <select className={s.sel} value={design.soilPsf} onChange={(e) => patch({ soilPsf: Number(e.target.value) as SoilPsf })}>
                  <option value={1500}>1,500 psf (code default)</option>
                  <option value={2000}>2,000 psf</option>
                  <option value={3000}>3,000 psf or more</option>
                </select>
              </Field>
            </div>
            <div className={s.sub} data-deck-site>
              <div className={s.subTitle}>The ground</div>
              <div className={s.grid2}>
                <Field label="Falls away from the house" aside={`in. over ${design.shape.depthFt} ft`}>
                  <NumberInput label="How far the ground falls away from the house across the deck, inches" value={design.site.slope.outDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, outDropIn: n2 } } })} />
                </Field>
                <Field label="Falls left to right" aside={`in. over ${design.shape.widthFt} ft`}>
                  <NumberInput label="How far the ground falls left to right across the deck, inches" value={design.site.slope.acrossDropIn} parse={intText} format={String} min={SLOPE_LIMITS.dropIn.min} max={SLOPE_LIMITS.dropIn.max} onCommit={(n2) => patch({ site: { ...design.site, slope: { ...design.site.slope, acrossDropIn: n2 } } })} />
                </Field>
              </div>
              <div className={s.chips}>
                <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => void readGround()} disabled={siteBusy || address.trim().length < 8} data-deck-read-ground>{siteBusy ? "Reading the lidar…" : "Read the ground from the address"}</button>
                {design.site.slope.outDropIn || design.site.slope.acrossDropIn ? <button type="button" className={cx(s.btn, s.btnSm, s.btnGhost)} onClick={() => patch({ site: { ...design.site, slope: { outDropIn: 0, acrossDropIn: 0 } } })}>Level</button> : null}
              </div>
              {siteNote ? <p className={s.hint}>{siteNote}</p> : null}
              <details className={s.factsMore} data-deck-facts>
                <summary>What the code and the site say here</summary>
                <ul className={s.siteFacts}>
                  <li data-deck-code>{site.codeLine}</li>
                  {site.basis.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                  {design.site.termite ? <li>Termite hazard here: {TERMITE_LABEL[design.site.termite]}.</li> : null}
                </ul>
              </details>
            </div>
            {!withDeck && design.floor === "ground" && r.attach !== "wall" ? <Toggle checked={design.footing.frostAlways} onChange={(v) => patch({ footing: { frostAlways: v } })}>Dig to the frost line anyway</Toggle> : null}
          </Step>

          {withDeck && frame ? (
            <Step n={next()} title="Frame" summary={frameSummary}>
              <Field label="Framing lumber" wide>
                <select className={s.sel} value={design.custom.species ? CUSTOM : design.framing.species} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("species") : patch({ framing: { species: e.target.value as DeckDesign["framing"]["species"] }, custom: { species: undefined } }, ["species"]))} data-deck-pick="species">
                  {speciesOptions}
                  <option value={CUSTOM}>{CUSTOM_LABEL}</option>
                </select>
              </Field>
              {design.custom.species ? (
                <CustomBox slot="species" title="Framing lumber" product={design.custom.species} unit={null} fresh={freshCustom === "species"} onDone={freshDone} onChange={(p) => setCustom("species", p)} onBack={() => setCustom("species", undefined)} note={`Named as typed on the plans and the material list. It spans by the code's tables for ${(FRAMING_SPECIES.find((f) => f.id === design.framing.species)?.label ?? "the lumber below").toLowerCase()} and is priced as that — your own lumber prices go under Your prices.`}>
                  <Field label="Spans and prices as" wide>
                    <select className={s.sel} value={design.framing.species} onChange={(e) => patch({ framing: { species: e.target.value as DeckDesign["framing"]["species"] } }, ["species"])} data-deck-like="species">
                      {speciesOptions}
                    </select>
                  </Field>
                </CustomBox>
              ) : (
                <p className={s.hint}>{frame.species.note}</p>
              )}
              <Field label="Joists" aside={design.framing.joist === "auto" ? `picked: ${frame.joistSize}` : undefined} wide>
                <Seg small label="Joists" value={design.framing.joist} onChange={(v) => patch({ framing: { joist: v } })} options={[{ value: "auto", label: "Auto" }, ...(["2x6", "2x8", "2x10", "2x12"] as const).map((j) => ({ value: j, label: j }))]} />
              </Field>
              <Field label="Joist spacing" aside={design.framing.spacingIn === "auto" ? `${frame.spacingIn} in. on center` : "on center"} wide>
                <Seg small label="Joist spacing" value={design.framing.spacingIn} onChange={(v) => patch({ framing: { spacingIn: v } })} options={[{ value: "auto", label: "Auto" }, { value: 12, label: '12"' }, { value: 16, label: '16"' }, { value: 24, label: '24"' }]} />
              </Field>
              <div className={s.grid2}>
                <Field label="Beam size" aside={design.framing.beam === "auto" ? `picked: ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")}` : undefined}>
                  <select className={s.sel} value={design.framing.beam} onChange={(e) => patch({ framing: { beam: e.target.value as DeckDesign["framing"]["beam"] } })}>
                    <option value="auto">Auto — least cost</option>
                    {(frame.beamKind === "solid" ? SOLID_BEAMS : BUILT_UP_CHOICES).map((b) => (
                      <option key={b} value={b}>{b.includes("-") ? `${b[0]}-ply ${b.slice(2)}` : b}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Posts">
                  <select className={s.sel} value={design.framing.post} onChange={(e) => patch({ framing: { post: e.target.value as DeckDesign["framing"]["post"] } })}>
                    {POST_SIZES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Footings" wide>
                <Seg small label="Footings" value={design.footing.type} onChange={(v) => patch({ footing: { type: v } })} options={[{ value: "poured", label: "Poured concrete" }, { value: "pier-block", label: "Precast pier blocks" }]} />
              </Field>
              {/* MORE FRAMING (2026-10-12, "polish — easy to use"): the choices most decks keep as the studio sets them, folded
                  under one line that says what they are now. */}
              <details className={s.moreBox} data-deck-more-frame>
                <summary>
                  <span className={s.moreTitle}>More framing choices</span>
                  <span className={s.moreSub}>{frameMoreWords}</span>
                </summary>
                <div className={s.moreBody}>
                  <Field label="Beams" aside={design.framing.beamStyle === "auto" ? (frame.beamStyle === "flush" ? "picked: flush" : "picked: under the joists") : undefined} wide>
                    <Seg small label="Beams" value={design.framing.beamStyle} onChange={(v) => patch({ framing: { beamStyle: v } })} options={[{ value: "auto", label: "Auto" }, { value: "dropped", label: "Under the joists" }, { value: "flush", label: "Flush" }]} />
                  </Field>
                  <div className={s.grid2}>
                    <Field label="Beam made of">
                      {/* What is built, not only what was asked (owner, 2026-10-11: "it says 4x but shows the 2-ply ones"): solid 4x
                          beams have no code span table for every lumber and load, and then the frame builds them up from 2x — the
                          select says so and the sizes below follow it. */}
                      <select className={s.sel} value={frame.beamKind} onChange={(e) => patch({ framing: { beamKind: e.target.value as DeckDesign["framing"]["beamKind"], beam: "auto" } })} data-deck-beam-kind={frame.beamKind}>
                        <option value="solid" disabled={!solidBeamTabulated(frame.load, frame.group)}>{solidBeamTabulated(frame.load, frame.group) ? "Solid 4x" : "Solid 4x — not in the code's tables for this lumber and load"}</option>
                        <option value="built-up">Built up from 2x</option>
                      </select>
                      {frame.beamKindNote ? <p className={cx(s.call, s.callWarn)} data-deck-beam-note>{frame.beamKindNote}</p> : null}
                    </Field>
                    <Field label="Joists past the beam" aside={design.framing.overhangFt === "auto" ? `auto: ${ftIn(frame.zones[0].frontCantIn)}` : "ft"}>
                      <select className={s.sel} value={String(design.framing.overhangFt)} onChange={(e) => patch({ framing: { overhangFt: e.target.value === "auto" ? "auto" : Number(e.target.value) } })}>
                        <option value="auto">Auto — up to 2 ft</option>
                        {[0, 0.5, 1, 1.5, 2, 2.5, 3].map((v) => (
                          <option key={v} value={v}>{v === 0 ? "None" : feetText(v).replace(/^(\d+)$/, "$1 ft")}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className={s.toggles}>
                    <Toggle checked={design.framing.doubleRim} onChange={(v) => patch({ framing: { doubleRim: v } })}>Doubled rim and outside joists</Toggle>
                    <Toggle checked={design.framing.joistTape} onChange={(v) => patch({ framing: { joistTape: v } })}>Joist tape on every top</Toggle>
                    <Toggle checked={design.framing.braces} onChange={(v) => patch({ framing: { braces: v } })}>Knee braces at corner posts over 2 ft</Toggle>
                    <Toggle checked={design.framing.blocking === "mid-span"} onChange={(v) => patch({ framing: { blocking: v ? "mid-span" : "auto" } })}>Mid-span blocking on spans over 8 ft</Toggle>
                    {design.heightIn >= 84 ? <Toggle checked={design.extras.underDeckDrain} onChange={(v) => patch({ extras: { underDeckDrain: v } })}>Under-deck drainage — a dry room below</Toggle> : null}
                  </div>
                  {design.placement === "attached" ? (
                    <div className={s.grid2}>
                      <Field label="Ledger fastened with">
                        <select className={s.sel} value={design.ledger.fastener} onChange={(e) => patch({ ledger: { fastener: e.target.value as DeckDesign["ledger"]["fastener"] } })}>
                          {wall.fasteners.map((f) => (
                            <option key={f} value={f}>{LEDGER_FASTENER_LABEL[f]}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Ties to the house">
                        <select className={s.sel} value={design.ledger.lateral} onChange={(e) => patch({ ledger: { lateral: e.target.value as "two" | "four" } })}>
                          <option value="two">Two 1,500-lb hold-downs</option>
                          <option value="four">Four 750-lb ties</option>
                        </select>
                      </Field>
                    </div>
                  ) : null}
                  {design.placement !== "attached" ? <Toggle checked={design.footing.frostAlways} onChange={(v) => patch({ footing: { frostAlways: v } })}>Dig to the frost line anyway</Toggle> : null}
                </div>
              </details>
            </Step>
          ) : null}

          {withDeck && frame && pkg.takeoff.surface ? (
            <Step n={next()} title="Surface" summary={surfaceSummary}>
              <Field label="Deck boards" wide>
                <select className={s.sel} value={design.custom.decking ? CUSTOM : design.decking.product} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("decking") : patch({ decking: { product: e.target.value }, custom: { decking: undefined } }, ["decking"]))} data-deck-pick="decking">
                  {deckingOptions}
                  <option value={CUSTOM}>{CUSTOM_LABEL}</option>
                </select>
              </Field>
              {design.custom.decking ? (
                <CustomBox slot="decking" title="Deck boards" product={design.custom.decking} unit="ft of board" fresh={freshCustom === "decking"} onDone={freshDone} onChange={(p) => setCustom("decking", p)} onBack={() => setCustom("decking", undefined)} note="Priced at your number per foot of board, the stair treads too. The joist spacing, the gaps and the clips follow the board it is laid like.">
                  <Field label="Laid like" wide>
                    <select className={s.sel} value={design.decking.product} onChange={(e) => patch({ decking: { product: e.target.value } }, ["decking"])} data-deck-like="decking">
                      {deckingOptions}
                    </select>
                  </Field>
                </CustomBox>
              ) : null}
              <p className={s.hint}>
                Joists no more than {frame.decking.maxSpacingIn.square} in. apart ({frame.decking.maxSpacingIn.diagonal} in. on the diagonal) — {frame.decking.sourceNote}.
              </p>
              {regional ? (
                <p className={s.hint} data-deck-regional={regional.region}>
                  {regionalWords(regional)} Builder surveys by region; remodels still lean on wood.
                </p>
              ) : null}
              <Field label="Pattern" wide>
                <Seg small label="Pattern" value={design.decking.pattern} onChange={(v) => patch({ decking: { pattern: v, diagonal: v !== "straight" } })} options={(["straight", "diagonal", "herringbone"] as const).map((v) => ({ value: v, label: PATTERN_LABEL[v] }))} />
              </Field>
              <Field label="Picture-frame border" wide>
                <Seg small label="Picture-frame border" value={design.decking.border} onChange={(v) => patch({ decking: { border: v } })} options={[{ value: 0, label: "None" }, { value: 1, label: "One board" }, { value: 2, label: "Two boards" }]} />
              </Field>
              <div className={s.grid2}>
                <Field label="Fastened with">
                  <select className={s.sel} value={design.custom.fastening ? CUSTOM : design.decking.fastening} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("fastening") : patch({ decking: { fastening: e.target.value as DeckDesign["decking"]["fastening"] }, custom: { fastening: undefined } }))} data-deck-pick="fastening">
                    <option value="auto">Auto — {pkg.takeoff.surface.fastening === "hidden" ? "hidden clips" : "screws"}</option>
                    <option value="screws">Deck screws</option>
                    {frame.decking.hiddenFasteners ? <option value="hidden">Hidden clips</option> : null}
                    <option value={CUSTOM}>{CUSTOM_LABEL}</option>
                  </select>
                </Field>
                <Field label="Fascia">
                  <select className={s.sel} value={design.custom.fascia && pkg.takeoff.surface.fascia.on ? CUSTOM : design.decking.fascia} onChange={(e) => (e.target.value === CUSTOM ? pickCustom("fascia") : patch({ decking: { fascia: e.target.value as DeckDesign["decking"]["fascia"] }, custom: { fascia: undefined } }))} data-deck-pick="fascia">
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
            </Step>
          ) : null}

          {withRoof && roof ? (
            <Step n={next()} title={design.structure === "pergola" ? "Pergola" : "Roof"} summary={roofSummary} id="step-roof">
              {kinds.length > 1 ? (
                <Field label="Roof shape" wide>
                  <Seg small label="Roof shape" value={r.kind} onChange={(k: RoofKind) => rp({ kind: k })} options={kinds.map((k) => ({ value: k, label: ROOF_KIND_LABEL[k].split(" — ")[0] }))} />
                </Field>
              ) : null}
              {roof.kindNote ? <p className={cx(s.hint, s.hintWarn)}>{roof.kindNote}</p> : null}
              {canAttach ? (
                <Field label="It stands" wide>
                  <Seg small label="On the house or free" value={r.attach} onChange={(a) => rp({ attach: a })} options={[{ value: "wall", label: "On the house wall" }, { value: "free", label: "Free-standing" }]} />
                </Field>
              ) : null}
              {withDeck ? outlineBlock : null}

              <div className={s.sub}>
                <div className={s.subTitle}>Posts and headers</div>
                <div className={s.grid2}>
                  <Field label="Height to the headers" aside={`in. · ${ftIn(r.eaveHeightIn)}`}>
                    <NumberInput label="Height from the floor to the underside of the headers, inches" value={r.eaveHeightIn} parse={parseInches} format={String} min={ROOF_LIMITS.eaveHeightIn.min} max={ROOF_LIMITS.eaveHeightIn.max} onCommit={(n2) => rp({ eaveHeightIn: n2 })} />
                  </Field>
                  <Field label="Posts">
                    <Seg small label="Roof posts" value={r.post} onChange={(p) => rp({ post: p })} options={(["4x4", "6x6", "8x8"] as const).map((p) => ({ value: p, label: p }))} />
                  </Field>
                </div>
                <div className={s.chips}>
                  {EAVE_PRESETS.map((h) => (
                    <button key={h.label} type="button" className={cx(s.chip, r.eaveHeightIn === h.inches && s.chipOn)} onClick={() => rp({ eaveHeightIn: h.inches })}>
                      {h.label} <span>to the headers</span>
                    </button>
                  ))}
                </div>
                <div className={s.grid2}>
                  <Field label="Headers (beams on the posts)" aside={r.header === "auto" ? `picked: ${[...new Set(roof.headers.map((h) => h.spec.size))].join(", ") || "—"}` : undefined}>
                    <select className={s.sel} value={r.header} onChange={(e) => rp({ header: e.target.value as RoofDesign["header"] })}>
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
                    <select className={s.sel} value={r.overhangIn} onChange={(e) => rp({ overhangIn: Number(e.target.value) })}>
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
              </div>

              <div className={s.sub}>
                <div className={s.subTitle}>{design.structure === "pergola" ? "Rafters and slats" : "Rafters and ridge"}</div>
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
                    <Seg small label="At the ridge" value={r.ridge} onChange={(v) => rp({ ridge: v })} options={[{ value: "auto", label: "Auto" }, { value: "beam", label: "Ridge beam", title: r.kind === "hip" ? "A beam on two king posts, each standing on a cross beam from eave header to eave header; the ceiling stays open" : "The rafters bear on a beam; the ceiling stays open" }, { value: "board", label: "Ridge board + ties", title: "A board between the rafters, with rafter ties every 4 ft" }, ...(r.kind === "gable" ? [{ value: "trusses" as const, label: "Trusses", title: "Manufactured trusses 24 in. on center, one piece header to header — designed and stamped by the truss maker" }] : [])]} />
                  </Field>
                ) : null}
                {/* CROSS BEAMS (2026-10-12, owner: "selections of beams for cross roof beams and supports"): under a gable's
                    ridge beam, each from eave header to eave header with a king post under the ridge — the ridge spans
                    shorter, and a post stands under each end. A free hip's ridge beam always stands on two. */}
                {roof.kind === "gable" && roof.ridge?.kind === "beam" && !roof.trusses ? (
                  <Field label="Cross beams under the ridge" aside={roof.crossBeams ? `the ridge spans ${ftIn(roof.ridge.spanIn)} between king posts` : "the ridge spans end to end"} wide>
                    <Seg small label="Cross beams under the ridge" value={r.crossBeams} onChange={(v) => rp({ crossBeams: v })} options={[0, 1, 2, 3].map((v) => ({ value: v, label: v === 0 ? "None" : String(v), title: v === 0 ? "The ridge beam spans from one end to the other on king posts" : `${v} cross beam${v > 1 ? "s" : ""} from eave to eave, each with a king post under the ridge and a post under each end` }))} />
                  </Field>
                ) : null}
                {roof.kind === "hip" && roof.attach === "free" && roof.ridge?.kind === "beam" ? (
                  <p className={s.hint} data-deck-hip-cross>The ridge beam stands on two king posts, each on a cross beam from eave header to eave header, with a post under each end of the cross beams. Nothing pushes the headers apart, so no ties.</p>
                ) : null}
                {roof.ringTensionLb > 0 ? (
                  <p className={s.hint} data-deck-ring>The hips push the corners out — about {roof.ringTensionLb.toLocaleString("en-US")} lb at each header joint. A tension strap across every joint holds the headers as a ring; they are in the material list.</p>
                ) : null}
                {design.structure === "pergola" && r.pergolaStyle !== "louvered" ? (
                  <div className={s.grid2}>
                    <Field label="Slats">
                      <Seg small label="Slats" value={r.slats.size} onChange={(v) => rp({ slats: { ...r.slats, size: v } })} options={(["2x2", "2x4", "2x6"] as const).map((v) => ({ value: v, label: v }))} />
                    </Field>
                    <Field label="Slat spacing" aside="in. apart">
                      <NumberInput label="Slat spacing, inches" value={r.slats.spacingIn} parse={intText} format={String} min={ROOF_LIMITS.slatSpacingIn.min} max={ROOF_LIMITS.slatSpacingIn.max} onCommit={(n2) => rp({ slats: { ...r.slats, spacingIn: n2 } })} />
                    </Field>
                  </div>
                ) : null}
                <Field label="Roof load" aside={r.load === "auto" ? `from the site: ${roof.roofLoad} psf` : undefined} wide>
                  <select className={s.sel} value={String(r.load)} onChange={(e) => rp({ load: e.target.value === "auto" ? "auto" : (Number(e.target.value) as RoofDesign["load"]) })}>
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
                  <div className={s.sub}>
                    <div className={s.subTitle}>Roofing and ceiling</div>
                    <div className={s.grid2}>
                      <Field label="Roofing">
                        <select
                          className={s.sel}
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
                          className={s.sel}
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
                          <select className={s.sel} value={r.roofing} onChange={(e) => rp({ roofing: e.target.value as RoofDesign["roofing"] })} data-deck-like="roofing">
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
                  </div>
                  <div className={s.sub}>
                    <div className={s.subTitle}>Fascia, soffit and gutters</div>
                    <div className={s.toggles}>
                      <Toggle checked={r.fascia.eave} onChange={(v) => rp({ fascia: { ...r.fascia, eave: v } })}>Fascia on the eaves ({Math.round(roof.eaveFt)} ft)</Toggle>
                      {roof.rakeFt > 0 ? <Toggle checked={r.fascia.rake} onChange={(v) => rp({ fascia: { ...r.fascia, rake: v } })}>Rake boards on the gable ends ({Math.round(roof.rakeFt)} ft)</Toggle> : null}
                      <Toggle checked={r.soffit} onChange={(v) => rp({ soffit: v })}>Vented soffit under the overhang</Toggle>
                    </div>
                    <div className={s.grid2}>
                      <Field label="Fascia finish">
                        <select
                          className={s.sel}
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
                          className={s.sel}
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
                          <select className={s.sel} value={r.gutters.kind} onChange={(e) => rp({ gutters: { ...r.gutters, kind: e.target.value as RoofDesign["gutters"]["kind"] } })} data-deck-like="gutters">
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
            </Step>
          ) : null}

          {withDeck ? (
            <Step n={next()} title="Stairs and railing" summary={extrasSummary} id="step-stairs">
              <div className={s.sub}>
                <div className={s.subTitle}>Railing</div>
                <div className={s.grid2}>
                  <Field label="Railing" aside={structure.rails.required && design.rail.type === "none" ? "a guard is required" : undefined}>
                    <select className={s.sel} value={design.rail.type} onChange={(e) => patch({ rail: { type: e.target.value as DeckDesign["rail"]["type"], infill: "auto" } })} data-deck-rail>
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
                        <select className={s.sel} value={design.rail.infill} onChange={(e) => patch({ rail: { infill: e.target.value as DeckDesign["rail"]["infill"] } })}>
                          {infills.map((v) => (
                            <option key={v} value={v}>{v === "auto" ? "Auto" : RAIL_INFILL_LABEL[v]}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Posts apart" aside="ft">
                        <Seg small label="Rail posts apart" value={design.rail.postSpacingFt} onChange={(v) => patch({ rail: { postSpacingFt: v } })} options={[{ value: 4, label: "4" }, { value: 6, label: "6" }, { value: 8, label: "8" }]} />
                      </Field>
                      {design.rail.type === "custom" ? (
                        <Field label="Your railing" wide>
                          <NameInput label="Your railing's name" value={design.rail.customName} placeholder="Brand, line, colour" allowEmpty onCommit={(name) => patch({ rail: { customName: name } })} />
                        </Field>
                      ) : null}
                      {design.rail.type === "custom" ? (
                        <Field label="Your rail price, installed" aside="$/ft">
                          <NumberInput label="Custom rail price per foot, installed" value={design.rail.customPerFt} parse={intText} format={String} min={0} max={1000} onCommit={(n2) => patch({ rail: { customPerFt: n2 } })} />
                        </Field>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {design.rail.type !== "none" ? (
                  <div className={s.toggles}>
                    {woodRail ? <Toggle checked={design.rail.cap} onChange={(v) => patch({ rail: { cap: v } })}>A flat 2x6 drink cap</Toggle> : null}
                    {design.lower.on ? <Toggle checked={design.rail.lowerLevel} onChange={(v) => patch({ rail: { lowerLevel: v } })}>Rail on the lower level too</Toggle> : null}
                  </div>
                ) : null}
                {structure.rails.on ? <p className={s.hint}>{railWords(structure.rails)}. Lit post caps and step lights are under Lights and outlets.</p> : null}
              </div>

              <div className={s.sub} data-deck-stairs>
                <div className={s.subTitle}>Stairs</div>
                <div className={s.rows}>
                  {design.stairs.map((st, i) => {
                    const built = structure.stairs.find((b) => b.design.id === st.id);
                    const sideLen = st.level === "lower" ? (st.side === "front" ? design.lower.widthFt : design.lower.depthFt) : st.side === "front" ? design.shape.widthFt : design.shape.depthFt;
                    return (
                      <Scope key={st.id} stair={st.id}><div className={s.row} data-deck-stair={st.id}>
                        <div className={s.rowHead}>
                          <span className={s.rowTitle}>{st.wrap ? "Box steps" : `Stair ${i + 1}`}{built ? ` · ${built.risers} risers of ${built.riserIn.toFixed(2)} in.${built.lands === "lower-deck" ? " to the lower level" : ""}` : ""}</span>
                          <button type="button" className={cx(s.btn, s.btnSm, s.btnDanger)} onClick={() => setStairs((list) => list.filter((x) => x.id !== st.id))}>Remove</button>
                        </div>
                        <div className={s.rowGrid}>
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
                            <select className={s.sel} value={st.landing} onChange={(e) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, landing: e.target.value as StairDesign["landing"] } : x)))}>
                              {(["pad", "patio", "grade"] as const).map((v) => (
                                <option key={v} value={v}>{STAIR_LANDING_LABEL[v]}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Handrail">
                            <select className={s.sel} value={st.handrail} onChange={(e) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, handrail: e.target.value as StairDesign["handrail"] } : x)))}>
                              <option value="auto">Auto — as the code asks</option>
                              <option value="both">Both sides</option>
                              <option value="one">One side</option>
                              <option value="none">None</option>
                            </select>
                          </Field>
                          {design.lower.on ? (
                            <Field label="From">
                              <Seg small label="From which level" value={st.level} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, level: v } : x)))} options={[{ value: "upper", label: "The deck" }, { value: "lower", label: "The lower level" }]} />
                            </Field>
                          ) : null}
                        </div>
                        {st.side === "front" ? (
                          <div className={s.rowActs}>
                            <Toggle checked={st.wrap} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, wrap: v } : x)))}>Box steps wrapping the deck (three risers at most)</Toggle>
                            {st.wrap ? <Seg small label="Wrap how many sides" value={st.wrapSides} onChange={(v) => setStairs((list) => list.map((x) => (x.id === st.id ? { ...x, wrapSides: v } : x)))} options={[{ value: 1, label: "Front" }, { value: 3, label: "Three sides" }, ...(design.placement === "detached" ? [{ value: 4 as const, label: "All four" }] : [])]} /> : null}
                          </div>
                        ) : null}
                      </div></Scope>
                    );
                  })}
                </div>
                <div className={s.chips}>
                  <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => setStairs((list) => [...list, defaultStair(`s${list.length + 1}-${Date.now().toString(36).slice(-3)}`, "front", design.shape.widthFt / 2)])} data-deck-add-stair>Add stairs down the front</button>
                  <button type="button" className={cx(s.btn, s.btnSm, placing?.kind === "stair" && s.btnOn)} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => { setPlacing(placing?.kind === "stair" ? null : { kind: "stair" }); if (view !== "3d" && view !== "plan") setView("3d"); }} data-deck-place-stair>{placing?.kind === "stair" ? (view === "plan" ? "Click the plan…" : "Click the deck…") : "Place by clicking the deck"}</button>
                </div>
              </div>
              <div className={s.sub} data-deck-extras>
                <div className={s.subTitle}>The old deck and the hardware</div>
                <div className={s.grid2}>
                  <Field label="Tear out an old deck" aside="sq ft">
                    <NumberInput label="Old deck to tear out, square feet" value={design.extras.demoSqFt} parse={intText} format={String} min={0} max={4000} onCommit={(n2) => patch({ extras: { demoSqFt: n2 } })} />
                  </Field>
                </div>
                <Toggle checked={design.extras.stainless} onChange={(v) => patch({ extras: { stainless: v } })}>Stainless connectors — within 300 ft of salt water</Toggle>
              </div>
            </Step>
          ) : null}

          <Step n={next()} title="Lights, outlets and heaters" summary={electricSummary} id="step-electrical">
            <p className={s.hint}>Tap what the {what.toLowerCase()} gets: each goes where it usually does, or click <b>Place in 3D</b> and touch the spot. Wiring, boxes and circuits are priced as electrical work; a fixture the client buys is drawn as a sample and left to be determined.</p>
            <div className={s.fixChips}>
              {FIXTURE_CHIPS.map((k) => (
                <button key={k} type="button" className={s.chip} disabled={design.electrical.fixtures.length >= ELECTRICAL_LIMITS.fixtures} onClick={() => setFixtures((list) => [...list, defaultFixture(`e${list.length + 1}-${Date.now().toString(36).slice(-3)}`, k)])} data-deck-add-fixture={k}>
                  + {FIXTURE_SHORT[k]}
                </button>
              ))}
            </div>
            <div className={s.rows}>
              {design.electrical.fixtures.map((f) => {
                const placedOnes = structure.electrical.fixtures.filter((pf) => pf.id === f.id || pf.id.startsWith(`${f.id}-`));
                return (
                  <Scope key={f.id} fixture={f.id}><div className={s.row} data-deck-fixture={f.id}>
                    <div className={s.rowHead}>
                      <span className={s.rowTitle}>{f.custom ? f.custom.name : FIXTURE_SHORT[f.kind]}{f.supply === "client" ? <span className={s.tbd}>by the client · TBD</span> : null}</span>
                      <button type="button" className={cx(s.btn, s.btnSm, s.btnDanger)} onClick={() => setFixtures((list) => list.filter((x) => x.id !== f.id))}>Remove</button>
                    </div>
                    <div className={s.rowGrid}>
                      <Field label="What">
                        <select
                          className={s.sel}
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
                      <Field label="Who buys the fixture" aside={f.supply === "client" ? "wiring and hanging stay in the price" : undefined}>
                        <Seg small label="Who buys the fixture" value={f.supply} onChange={(v) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, supply: v } : x)))} options={[{ value: "we", label: "We supply it" }, { value: "client", label: "The client" }]} />
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
                          <select className={s.sel} value={f.kind} onChange={(e) => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, kind: e.target.value as FixtureKind, at: null } : x)))} data-deck-like="fixture">
                            {fixtureOptions}
                          </select>
                        </Field>
                      </CustomBox>
                    ) : null}
                    <div className={s.rowActs}>
                      <button type="button" className={cx(s.btn, s.btnSm, placing?.kind === "fixture" && placing.id === f.id && s.btnOn)} onClick={() => { setPlacing(placing?.kind === "fixture" && placing.id === f.id ? null : { kind: "fixture", id: f.id }); setView("3d"); }} data-deck-place-fixture={f.id}>
                        {placing?.kind === "fixture" && placing.id === f.id ? "Click the 3D…" : f.at ? "Move it in 3D" : "Place in 3D"}
                      </button>
                      {f.at ? <button type="button" className={cx(s.btn, s.btnSm, s.btnGhost)} onClick={() => setFixtures((list) => list.map((x) => (x.id === f.id ? { ...x, at: null } : x)))}>Back to the usual spot</button> : null}
                      <span className={s.mono}>{f.at ? `on the ${f.at.on}` : placedOnes.length ? `${placedOnes.length === 1 ? "placed" : `${placedOnes.length} placed`} where it usually goes` : ""}</span>
                    </div>
                  </div></Scope>
                );
              })}
            </div>
            {structure.electrical.on ? (
              <>
                <div className={s.grid2}>
                  <Field label="Panel to the structure" aside="ft of feed">
                    <NumberInput label="Feet from the house's panel to the structure" value={design.electrical.feedFt} parse={intText} format={String} min={ELECTRICAL_LIMITS.feedFt.min} max={ELECTRICAL_LIMITS.feedFt.max} onCommit={(n2) => patch({ electrical: { ...design.electrical, feedFt: n2 } })} />
                  </Field>
                  <Field label="The feed comes from the">
                    <Seg small label="Panel side" value={design.electrical.panelSide} onChange={(v) => patch({ electrical: { ...design.electrical, panelSide: v } })} options={[{ value: "left", label: "Left end" }, { value: "right", label: "Right end" }]} />
                  </Field>
                </div>
                <Toggle checked={design.electrical.timer} onChange={(v) => patch({ electrical: { ...design.electrical, timer: v } })}>A timer or photocell on the lights</Toggle>
                <p className={s.hint}>{electricalWords(structure.electrical)} · {structure.electrical.boxes} boxes · {structure.electrical.switches} switches{structure.electrical.lv ? ` · ${structure.electrical.lv.transformers} transformer${structure.electrical.lv.transformers > 1 ? "s" : ""}` : ""}{structure.electrical.trenchFt ? ` · ${structure.electrical.trenchFt} ft of trench` : ""}. Turn on <b>Night</b> over the 3D to see them lit.</p>
              </>
            ) : null}
          </Step>

          {PHOTO_ENABLED ? (
          <Step n={next()} title="Photo of the house" summary={photoSummary} id="step-photo">
            <p className={s.hint}>A picture of the back of the house, taken square on from the yard. The studio finds the wall, the door and the windows, cuts the picture to the wall and sets the {what.toLowerCase()} against it at the right size — then you drag it if it should sit elsewhere. It is drawn over the picture where you place it, and the client&apos;s page shows their own house with it in place.</p>
            <div className={s.chips}>
              <button type="button" className={cx(s.btn, s.btnSm, !design.photo && s.btnPrimary)} onClick={pickPhoto} disabled={photoBusy} data-deck-photo-add>
                {photoBusy ? (photoStage ?? "Saving the picture…") : design.photo ? "Another photo" : "Add a photo"}
              </button>
              {design.photo ? (
                <>
                  <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => setView("photo")}>Place it on the photo</button>
                  <button type="button" className={cx(s.btn, s.btnSm)} onClick={removePhoto}>Remove</button>
                </>
              ) : null}
            </div>
            {photoError ? <p className={cx(s.call, s.callBad)} role="alert">{photoError}</p> : null}
          </Step>
          ) : null}
        </div>
        </FieldScope.Provider>
      </div>

      {/* ── the price ─────────────────────────────────────────────── */}
      <section className={cx(s.card, s.price)} aria-label="Price">
        <div className={s.hero}>
          <div className={s.heroCell}>
            <div className={s.kpi}>{what} price</div>
            <div className={cx(s.heroV, s.accent)}>{money(pkg.subtotal)}</div>
            <div className={s.heroH}>before tax</div>
          </div>
          <div className={s.heroCell}>
            <div className={s.kpi}>Per square foot</div>
            <div className={s.heroV}>{money(pkg.pricePerSqFt, true)}</div>
            <div className={s.heroH}>{Math.round(pkg.areaSqFt)} sq ft{withDeck ? " of deck" : " of floor"}</div>
          </div>
          <div className={s.heroCell}>
            <div className={s.kpi}>Material</div>
            <div className={s.heroV}>{money(pkg.materialSubtotal)}</div>
            <div className={s.heroH}>{pkg.bom.length} lines in the package</div>
          </div>
          <div className={s.heroCell}>
            <div className={s.kpi}>Labor</div>
            <div className={s.heroV}>{money(pkg.laborSubtotal)}</div>
            <div className={s.heroH}>by the measure</div>
          </div>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>On the proposal</th>
                <th className={s.r}>Qty</th>
                <th className={s.r}>Material</th>
                <th className={s.r}>Labor</th>
                <th className={s.r}>Total</th>
              </tr>
            </thead>
            <tbody>
              {pkg.lines.map((l) => (
                <tr key={l.id} data-line={l.id}>
                  <td>
                    <div className={s.lineName}>{l.name}{l.tbd ? <span className={s.tbd}>to be determined</span> : null}</div>
                    {l.description ? <div className={s.lineDesc}>{l.description}</div> : null}
                  </td>
                  <td className={cx(s.r, s.nums)}>
                    {l.quantity.toLocaleString("en-US")} <span className={s.unit}>{l.unit}</span>
                  </td>
                  <td className={cx(s.r, s.nums)}>{money(l.materialCost, true)}</td>
                  <td className={cx(s.r, s.nums)}>{money(l.laborCost, true)}</td>
                  <td className={cx(s.r, s.nums, s.strong)}>{money(l.quantity * l.unitPrice, true)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {/* One cell a column (2026-10-12): a phone hides the material and labor columns, and a cell spanning four
                    held the table wider than the card. */}
                <td>Subtotal, before tax</td>
                <td />
                <td />
                <td />
                <td className={cx(s.r, s.nums, s.strong)}>{money(pkg.subtotal, true)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {tiers ? (
          <div className={s.tiers} data-deck-tiers>
            {tiers.map((t) => (
              <div key={t.id} className={cx(s.tier, t.current && s.tierOn)}>
                <div className={s.tierName}>{t.name}{t.current ? " · this one" : ""}</div>
                <div className={s.tierV}>{money(t.subtotal)}</div>
                <div className={s.tierH}>{t.words} {money(t.perSqFt, true)} a square foot.</div>
                {!t.current ? <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => patch({ decking: { product: t.product }, rail: { type: design.rail.type === "none" && !structure.rails.required ? "none" : t.rail }, custom: { decking: undefined } }, ["decking"])}>Use this</button> : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className={s.convert}>
          {exampleShare > 0 ? (
            <p className={cx(s.call, s.callWarn)}>
              <b>{exampleShare}% of this price stands on example prices.</b> Set your own under <a href="#deck-rates">Your prices</a> before it goes to a client — the proposal can still be edited line by line.
            </p>
          ) : null}
          {summary.fail ? (
            <p className={cx(s.call, s.callBad)}>
              <b>{summary.fail === 1 ? "One check fails" : `${summary.fail} checks fail`}.</b> The proposal can be made, but fix the frame before the client sees it — see <a href="#deck-checks">the checks</a>.
            </p>
          ) : null}
          {error && actAt === "bottom" ? <p className={cx(s.call, s.callBad)} role="alert">{error}</p> : null}
          <div className={s.convertRow}>
            <div className={s.mono}>{title}</div>
            <div className={s.rowActs}>
              {permitHref ? (
                <a className={cx(s.btn)} href={permitHref as Route} target="_blank" rel="noopener" data-deck-permit>
                  Permit &amp; build set
                </a>
              ) : null}
              {linked && !linked.lock ? (
                <>
                  <button type="button" className={cx(s.btn)} disabled={!!busy} onClick={convert} data-deck-convert-new>
                    {busy === "convert" ? "Making the proposal…" : "Save as a new proposal"}
                  </button>
                  <button type="button" className={cx(s.btn, s.btnPrimary)} disabled={!!busy || !behind} onClick={() => askUpdate("bottom")} data-deck-update="bottom">
                    {busy === "update" ? "Updating…" : !behind ? `${linked.ref} is up to date` : summary.fail ? "Update anyway" : `Update ${linked.ref}`}
                  </button>
                </>
              ) : (
                <button type="button" className={cx(s.btn, s.btnPrimary)} disabled={!!busy} onClick={convert} data-deck-convert>
                  {busy === "convert" ? "Making the proposal…" : linked ? "Save as a new proposal" : summary.fail ? "Convert anyway" : "Convert to proposal"}
                </button>
              )}
            </div>
          </div>
          {confirmAt === "bottom" ? confirmBox : null}
          {linked && updated && !behind ? (
            <p className={cx(s.call, s.callPass)} role="status" data-deck-updated>
              <b>{linked.ref} updated {ago(updated.at)}.</b> {updatedWords} <a href={`/dashboard/manual-blueprint?proposal=${encodeURIComponent(linked.id)}`}>Open the proposal</a>
            </p>
          ) : null}
        </div>
      </section>

      {/* ── the checks ────────────────────────────────────────────── */}
      <section className={s.card} id="deck-checks" aria-label="Code checks">
        <div className={s.head}>
          <div>
            <div className={s.cardTitle}>Code checks</div>
            <div className={s.cardSub}>Each part against the table it is sized from. Estimating grade — the building department decides.</div>
          </div>
          <div className={s.headStamps}>
            {summary.fail ? <span className={cx(s.stamp, s.stampBad)}>{summary.fail} fix</span> : null}
            {summary.warn ? <span className={cx(s.stamp, s.stampWarn)}>{summary.warn} check</span> : null}
            <span className={cx(s.stamp, s.stampPass)}>{summary.pass} pass</span>
            {fixableCount ? (
              <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} onClick={runAutoFix} data-deck-autofix>
                Auto-fix {fixableCount === 1 ? "1 item" : `${fixableCount} items`}
              </button>
            ) : null}
          </div>
        </div>
        {fixReport ? (
          <div className={cx(s.call, fixReport.left.length ? s.callWarn : null, s.fixReport)} role="status" data-deck-fix-report>
            <button type="button" className={s.fixReportClose} onClick={() => setFixReport(null)} aria-label="Close">×</button>
            {fixReport.fixed.length ? (
              <p><b>Fixed:</b> {fixReport.fixed.join(" · ")}.</p>
            ) : (
              <p><b>Nothing the studio can change on its own.</b></p>
            )}
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
        {/* What needs the contractor first (2026-10-12); the notes and the passes fold away under it. */}
        <ul className={s.checks}>
          {ordered.filter(loud).map((c) => checkRow(c))}
        </ul>
        {ordered.some((c) => !loud(c)) ? (
          <details className={s.checksMore} data-deck-checks-more>
            <summary>
              {(() => {
                const notes = ordered.filter((c) => !loud(c) && c.level === "info").length;
                const passes = ordered.filter((c) => c.level === "pass").length;
                return [notes ? `${notes} ${notes === 1 ? "note" : "notes"}` : "", passes ? `${passes} passed` : ""].filter(Boolean).join(" and ");
              })()}
            </summary>
            <ul className={s.checks}>{ordered.filter((c) => !loud(c)).map((c) => checkRow(c))}</ul>
          </details>
        ) : null}
      </section>

      {/* ── the material package ──────────────────────────────────── */}
      <section className={s.card} aria-label="Material package">
        <div className={s.head}>
          <div>
            <div className={s.cardTitle}>Material package</div>
            <div className={s.cardSub}>What to load on the truck, in the lengths the yard sells. Lumber near the soil is ordered ground-contact. A fixture the client buys is listed, not priced.</div>
            <div className={s.materialActs}>
              {materialsHref("yard") ? <a className={cx(s.btn, s.btnSm, s.btnPrimary)} href={materialsHref("yard")! as Route} target="_blank" rel="noopener" data-deck-materials="yard">Material list for the lumber yard ↗</a> : null}
              {materialsHref("installer") ? <a className={cx(s.btn, s.btnSm)} href={materialsHref("installer")! as Route} target="_blank" rel="noopener" data-deck-materials="installer">For the installer to buy ↗</a> : null}
              {bomByStep.size ? (
                <button type="button" className={cx(s.btn, s.btnSm, s.btnGhost)} onClick={() => setBomOpen((prev) => ([...bomByStep.keys()].every((k) => prev.has(k)) ? new Set() : new Set(bomByStep.keys())))} data-bom-all>
                  {[...bomByStep.keys()].every((k) => bomOpen.has(k)) ? "Close all lines" : "Open all lines"}
                </button>
              ) : null}
            </div>
          </div>
          <div className={s.mono}>
            {Math.round(pkg.takeoff.framingLf)} ft of framing · {pkg.takeoff.concreteBags} bags · {pkg.takeoff.footings} footings{pkg.takeoff.roofSquares ? ` · ${pkg.takeoff.roofSquares} squares of roof` : ""}{pkg.takeoff.stairRisers ? ` · ${pkg.takeoff.stairRisers} risers` : ""}{pkg.takeoff.railLf ? ` · ${Math.round(pkg.takeoff.railLf)} ft of rail` : ""}
          </div>
        </div>
        <div className={s.tableWrap}>
          <table className={cx(s.table, s.bom)}>
            <thead>
              <tr>
                <th className={s.r}>Qty</th>
                <th>Item</th>
                <th className={cx(s.r, s.bomEach)}>Each</th>
                <th className={s.r}>Cost</th>
              </tr>
            </thead>
            {[...bomByStep].map(([step, rows]) => (
              <tbody key={step} data-bom-step={step}>
                <tr className={s.groupRow}>
                  {/* Two cells and an empty "Each" (2026-10-12): a phone hides that column, and a cell spanning it set the
                      group's subtotal a column right of the lines' costs. */}
                  <td colSpan={2}>
                    <button type="button" className={s.groupToggle} aria-expanded={bomOpen.has(step)} onClick={() => toggleBom(step)} data-bom-toggle={step}>
                      <span className={s.groupCaret} aria-hidden="true">▸</span>
                      {BOM_STEP_LABEL[step]}
                      <span className={s.groupCount}>{rows.length === 1 ? "1 line" : `${rows.length} lines`}</span>
                    </button>
                  </td>
                  <td className={s.bomEach} />
                  <td className={cx(s.r, s.nums)}>{money(rows.reduce((a, l) => a + l.cost, 0), true)}</td>
                </tr>
                {rows.map((l) => (
                  <tr key={l.id} className={bomOpen.has(step) ? undefined : s.bomHidden}>
                    <td className={cx(s.r, s.nums)}>
                      {l.qty.toLocaleString("en-US")} <span className={s.unit}>{l.unit}</span>
                    </td>
                    <td>
                      <div className={s.lineName}>{l.label}{l.byClient ? <span className={s.tbd}>by the client</span> : null}</div>
                      {l.note ? <div className={s.lineDesc}>{l.note}</div> : null}
                    </td>
                    <td className={cx(s.r, s.nums, s.bomEach)}>
                      {l.byClient ? "—" : money(l.unitPrice, true)}
                      {l.source === "store" && !l.byClient ? <span className={s.example} title={`${STORE_SURVEY.label} — set yours under Your prices`} data-price-source="store">{STORE_SURVEY.short}</span> : l.source !== "book" && !l.byClient ? <span className={s.example} title="An example price — set yours under Your prices" data-price-source="example">ex</span> : null}
                    </td>
                    <td className={cx(s.r, s.nums)}>{l.byClient ? "TBD" : money(l.cost, true)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        {/* Anything no list carries (owner, 2026-10-12: "always an option custom"): on the material list and in the price as typed. */}
        <div className={s.ownBox} data-deck-own-items>
          <div className={s.customHead}>
            <span className={s.subTitle}>Not on the list? Add your own</span>
            {design.extras.items.length ? <span className={s.mono}>{design.extras.items.length} of {CUSTOM_LIMITS.items}</span> : null}
          </div>
          {design.extras.items.map((it) => (
            <div key={it.id} className={s.ownRow} data-deck-own={it.id}>
              <Field label="Item">
                <NameInput label="Item name" value={it.name} onCommit={(name) => setOwnItem(it.id, { name })} />
              </Field>
              <Field label="Qty">
                <NumberInput label={`${it.name}: quantity`} value={it.qty} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.qty.min} max={CUSTOM_LIMITS.qty.max} onCommit={(qty) => setOwnItem(it.id, { qty })} />
              </Field>
              <Field label="Unit">
                <select className={s.sel} value={it.unit} onChange={(e) => setOwnItem(it.id, { unit: e.target.value as OwnUnit })} aria-label={`${it.name}: unit`}>
                  {OWN_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </Field>
              <Field label="Price" aside={`$ per ${it.unit}`}>
                <NumberInput label={`${it.name}: price per ${it.unit}`} value={it.price} parse={priceText} format={priceShow} min={CUSTOM_LIMITS.price.min} max={CUSTOM_LIMITS.price.max} onCommit={(price) => setOwnItem(it.id, { price })} />
              </Field>
              <button type="button" className={cx(s.btn, s.btnSm, s.btnDanger)} onClick={() => setOwnItems((list) => list.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.name}`}>
                Remove
              </button>
            </div>
          ))}
          {design.extras.items.length < CUSTOM_LIMITS.items ? (
            <form
              className={s.ownRow}
              onSubmit={(e) => {
                e.preventDefault();
                addOwnItem();
              }}
              data-deck-own-new
            >
              <Field label="Item">
                <input className={s.in} placeholder="A brand or a part no list here carries" maxLength={CUSTOM_LIMITS.name} value={ownDraft.name} onChange={(e) => setOwnDraft((d) => ({ ...d, name: e.target.value }))} aria-label="New item's name" />
              </Field>
              <Field label="Qty">
                <input className={cx(s.in, s.num)} inputMode="decimal" value={ownDraft.qty} onChange={(e) => setOwnDraft((d) => ({ ...d, qty: e.target.value }))} aria-label="New item's quantity" />
              </Field>
              <Field label="Unit">
                <select className={s.sel} value={ownDraft.unit} onChange={(e) => setOwnDraft((d) => ({ ...d, unit: e.target.value as OwnUnit }))} aria-label="New item's unit">
                  {OWN_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </Field>
              <Field label="Price" aside={`$ per ${ownDraft.unit}`}>
                <input className={cx(s.in, s.num)} inputMode="decimal" placeholder="0.00" value={ownDraft.price} onChange={(e) => setOwnDraft((d) => ({ ...d, price: e.target.value }))} aria-label="New item's price per unit" />
              </Field>
              <button type="submit" className={cx(s.btn, s.btnSm, s.btnPrimary)} disabled={!ownDraft.name.trim()}>
                + Add
              </button>
            </form>
          ) : null}
          <p className={s.hint}>Goes on the material list under Your own items and into the price as typed. Every list above ends with Custom too — for a board, a roofing or a fixture the lists don&rsquo;t carry.</p>
        </div>
      </section>

      {/* ── the shop's prices ─────────────────────────────────────── */}
      <section className={s.card} id="deck-rates" aria-label="Your prices">
        <div className={s.head}>
          <div>
            <div className={s.cardTitle}>Your prices</div>
            <div className={s.cardSub}>Every default here is an example, scaled to {market.label}. Type your own and save: your number is charged as typed, on every deck from then on. Leave a row blank to go back to the example. The same book is on the <a href="/dashboard/deck-estimator/inventory">deck inventory page</a>.</div>
          </div>
          <div className={s.headStamps}>
            {saving === "saved" && !unsaved ? <span className={cx(s.stamp, s.stampPass)}>Saved</span> : null}
            {saving === "failed" ? <span className={cx(s.stamp, s.stampBad)}>Not saved</span> : null}
            <button type="button" className={cx(s.btn, s.btnPrimary, s.btnSm)} disabled={!unsaved || saving === "saving"} onClick={saveBook}>
              {saving === "saving" ? "Saving…" : "Save my prices"}
            </button>
          </div>
        </div>
        <div className={s.rates}>
          {(Object.keys(DECK_RATE_GROUP_LABEL) as DeckRateGroup[]).map((group) => (
            <details key={group} className={s.rateGroup}>
              <summary>
                {DECK_RATE_GROUP_LABEL[group]}
                <span className={s.mono}>{DECK_RATES.filter((rt) => rt.group === group && draftBook[rt.key] !== undefined).length || "no"} set</span>
              </summary>
              <div className={s.rateRows}>
                {DECK_RATES.filter((rt) => rt.group === group).map((rt) => {
                  const example = deckRate(rt.key, undefined, market).price;
                  return (
                    <label key={rt.key} className={s.rateRow}>
                      <span className={s.rateLabel}>{rt.label}</span>
                      <span className={s.rateUnit}>per {rt.unit}{rt.basis !== "labor" && storePrice(rt.key) ? ` · ${STORE_SURVEY.short} ${STORE_SURVEY.asOf.slice(0, 7)}` : ""}</span>
                      <input className={cx(s.in, s.num, s.rateIn)} inputMode="decimal" placeholder={example.toFixed(2)} value={drafts2[rt.key] ?? ""} onChange={(e) => setDrafts2((d) => ({ ...d, [rt.key]: e.target.value }))} />
                    </label>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </section>

      {viewerOut ? (
        <div className={s.priceBar} role="region" aria-label="Price" data-deck-pricebar>
          <a className={s.priceBarMain} href="#deck-checks">
            <span className={s.priceBarV}>{money(pkg.subtotal)}</span>
            <span className={cx(s.stamp, summary.fail ? s.stampBad : summary.warn ? s.stampWarn : s.stampPass)}>{summary.fail ? `${summary.fail} to fix` : summary.warn ? `${summary.warn} to check` : "Inside the tables"}</span>
          </a>
          <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} onClick={() => viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            See it ↑
          </button>
        </div>
      ) : null}
    </div>
  );
}

export type { DeckPackage };
