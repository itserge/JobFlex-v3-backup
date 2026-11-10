"use client";
// THE CLIENT'S DECK DESIGNER (2026-10-11) — /deck-design/<token>. Owner:
// "the client doesn't see a price; the client can start from blank or from
// the contractor's design to correct and finalize; make it smart and easy
// for the client."
//
// One page, phone first: the 3D on top (it follows every change; drag its
// knobs, tap an edge for stairs, watch it build), and under it the few
// things a homeowner decides — what it is, its size and shape, how high,
// the stairs, the railing, the boards, the roof's look, a lower level — each
// as pictures or plain buttons, never a table. The work saves itself a
// moment after each change; Send hands it to the contractor (actions/
// deckClientDesign), who gets it framed to the code tables in the studio.
//
// The engine runs here as it does in the studio (lib/deck: the structure
// and the 3D scene), but nothing is priced: no rate book reaches this page
// and the price module is never called. The code still speaks where a
// homeowner should hear it — a railing is required above 30 in., a raised
// deck wants stairs — and acts on it (a railing comes back on its own).

import * as React from "react";
import dynamic from "next/dynamic";
import { deckingProduct, railColorOf, railColors, railType, treatedDecking, type RailTypeId } from "@/lib/deck/catalog";
import { deckingColors } from "@/lib/deck/deckingColors";
import { applyDeckPatch } from "@/lib/deck/checks";
import { LEAD_CONSENT_TEXT } from "@/lib/leadConsent";
import { PRO } from "@/lib/home/jobflexPro";
import {
  DECK_LIMITS,
  LOWER_LIMITS,
  PERGOLA_STYLE_LABEL,
  ROOF_KIND_LABEL,
  ROOF_LIMITS,
  STAIR_LIMITS,
  STAIR_SIDE_LABEL,
  WALL_FILL_LABEL,
  defaultLowerLevel,
  defaultStair,
  hasDeck,
  hasRoof,
  isPolygonShape,
  shapeAreaSqFt,
  structureWords,
  type CeilingKind,
  type DeckDesign,
  type DeckPattern,
  type DeckShape,
  type PergolaStyle,
  type RoofDesign,
  type RoofKind,
  type RoofPlanShape,
  type Roofing,
  type StairSide,
  type Structure,
  type WallFill,
} from "@/lib/deck/design";
import { HOUSE_LIMITS, deckShapeForHouse, houseForShape, houseWords, moveJogTo } from "@/lib/deck/house";
import { buildStructure, type DeckStructure } from "@/lib/deck/structure";
import { deckScene, sceneBuildLayers } from "@/lib/deck/scene";
import { kindSample, type DeckSample } from "@/lib/deck/samples";
import { CLIENT_NOTE_MAX, litWords, type ClientStart, type ClientUnsure } from "@/lib/deck/clientDesign";
import type { DeckEdit, DeckLook, DeckPick, SceneHighlight } from "@/components/estimator/deck/DeckModel3D";
import { fieldLight, type FieldFocus } from "@/lib/deck/fieldParts";
import { nearestStairEdge } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import { DeckKindPicker } from "@/components/v3/deck-estimator-blueprint/deck-kind-picker";
import { markDeckClientOpened, saveDeckClientWork, sendDeckClientDesign } from "@/actions/deckClientDesign";
import { Chips, Section, Stepper, clamp, cx, ftWords, half, inWords } from "./parts";
import { ClientHouse } from "./client-house";
import { ClientHousePhoto } from "./client-house-photo";
import s from "./deck-client-designer.module.css";
// The Talk to design button and the panel's styles load with the page (the panel itself loads when first opened).
import "@/components/v3/deck-voice/deck-voice.css";
import type { DeckVoiceHost } from "@/components/v3/deck-voice/deck-voice";
import { Mic } from "lucide-react";

// Talk to design (2026-10-21): the studio's voice panel in the client's mode — loaded when it is opened.
const DeckVoice = dynamic(() => import("@/components/v3/deck-voice/deck-voice").then((m) => m.DeckVoice), { ssr: false, loading: () => null });

const DeckModel3D = dynamic(() => import("@/components/estimator/deck/DeckModel3D").then((m) => m.DeckModel3D), {
  ssr: false,
  loading: () => <div className={s.wait}>Setting up the 3D view…</div>,
});


/** The knobs a homeowner may drag: sizes, heights, stairs, the roof — and their own house's steps and corners (2026-10-12). */
const CLIENT_HANDLES = new Set<string>(["width", "depth", "height", "eave", "stair", "stair-width", "lower-depth", "roof-width", "roof-depth", "pitch", "jog", "house-left", "house-right"]);

/* ── the words a homeowner reads ────────────────────────────────────── */

const RAIL_CHOICES: ReadonlyArray<{ id: RailTypeId; name: string; words: string }> = [
  { id: "none", name: "No railing", words: "Open edges — for low decks only." },
  { id: "treated", name: "Wood", words: "Pressure-treated; stain or paint it." },
  { id: "cedar", name: "Cedar", words: "Natural wood with a warm colour." },
  { id: "composite", name: "Composite", words: "Low upkeep; matches composite boards." },
  { id: "vinyl", name: "Vinyl", words: "Clean white, never needs paint." },
  { id: "aluminum", name: "Aluminum", words: "Slim metal posts and balusters." },
  { id: "cable", name: "Cable", words: "Thin steel cables — keeps the view." },
  { id: "glass", name: "Glass", words: "Clear panels, nothing in the way." },
];

interface BoardChoice {
  key: string;
  name: string;
  words: string;
  product: (state: string | null, current: string) => string;
  family: string[];
}
const BOARD_CHOICES: readonly BoardChoice[] = [
  { key: "treated", name: "Pressure-treated wood", words: "The classic. Stain it any colour.", // The REGION'S TREATED board, never its default board (fixed 2026-10-13: on the West Coast the default is a
  // composite, so this button changed nothing there).
  product: (st, cur) => (deckingProduct(cur).family === "treated" ? cur : treatedDecking(st)), family: ["treated"] },
  { key: "cedar", name: "Cedar", words: "Soft, warm, smells like cedar.", product: () => "cedar-54", family: ["cedar-54", "cedar-2x6"] },
  { key: "redwood", name: "Redwood", words: "Deep red heartwood.", product: () => "redwood-54", family: ["redwood-54", "redwood-2x6"] },
  { key: "ipe", name: "Ipe hardwood", words: "Dense tropical wood that lasts decades.", product: () => "ipe-54", family: ["ipe-54", "ipe-1x6"] },
  { key: "composite-good", name: "Composite · classic", words: "No staining, no splinters.", product: () => "composite-good", family: ["composite-good"] },
  { key: "composite-better", name: "Composite · enhanced", words: "Richer colour, deeper grain.", product: () => "composite-better", family: ["composite-better"] },
  { key: "composite-best", name: "Composite · premium", words: "The most natural-looking boards.", product: () => "composite-best", family: ["composite-best"] },
  { key: "pvc", name: "PVC", words: "Cooler underfoot; no wood at all.", product: () => "pvc", family: ["pvc"] },
  { key: "aluminum", name: "Aluminum", words: "Fireproof; never rots.", product: () => "aluminum", family: ["aluminum"] },
];
const boardKeyOf = (product: string): string | null => {
  const p = deckingProduct(product);
  if (p.family === "treated") return "treated";
  return BOARD_CHOICES.find((b) => b.family.includes(product))?.key ?? null;
};

const PATTERNS: ReadonlyArray<{ id: DeckPattern; name: string }> = [
  { id: "straight", name: "Straight" },
  { id: "diagonal", name: "Diagonal" },
  { id: "herringbone", name: "Herringbone" },
];

type ShapeKey = "rect" | "curve" | "clipped" | "L-left" | "L-right" | "L-back";
const SHAPES: ReadonlyArray<{ key: Exclude<ShapeKey, "L-back">; name: string; path: string }> = [
  { key: "rect", name: "Rectangle", path: "M4 6h32v22H4z" },
  { key: "L-left", name: "L-shape, left", path: "M4 6h32v22H16V18H4z" },
  { key: "L-right", name: "L-shape, right", path: "M4 6h32v12H24v10H4z" },
  { key: "curve", name: "Curved front", path: "M4 6h32v14Q20 34 4 20z" },
  { key: "clipped", name: "Angled corners", path: "M4 6h32v14l-8 8H12l-8-8z" },
];
function shapeKey(sh: DeckShape): ShapeKey {
  if (sh.kind === "L") return sh.notch.corner === "front-left" ? "L-left" : sh.notch.corner === "front-right" ? "L-right" : "L-back";
  // A deck that follows the house wall is a rectangle the wall's steps shape — the wall, not this picker, sets them.
  if (sh.kind === "wall") return "rect";
  if (sh.front?.kind === "curve") return "curve";
  if (sh.front?.kind === "clipped") return "clipped";
  return "rect";
}
function shapeFor(key: ShapeKey, W: number, D: number, current: DeckShape): DeckShape {
  switch (key) {
    case "curve":
      return { kind: "rect", widthFt: W, depthFt: D, front: { kind: "curve", bulgeFt: clamp(Math.round(D / 4), DECK_LIMITS.bulgeFt.min, DECK_LIMITS.bulgeFt.max), clipFt: 2 } };
    case "clipped":
      return { kind: "rect", widthFt: W, depthFt: D, front: { kind: "clipped", bulgeFt: 2, clipFt: clamp(Math.round(Math.min(W, D) / 4), DECK_LIMITS.clipFt.min, DECK_LIMITS.clipFt.max) } };
    case "L-left":
    case "L-right":
      return { kind: "L", widthFt: W, depthFt: D, notch: { corner: key === "L-left" ? "front-left" : "front-right", widthFt: clamp(Math.round(W / 2), 2, W - 3), depthFt: clamp(Math.round(D / 2), 2, D - 3) } };
    case "L-back":
      return current;
    default:
      return { kind: "rect", widthFt: W, depthFt: D };
  }
}

const HEIGHTS: ReadonlyArray<{ inches: number; name: string; words: string }> = [
  { inches: 12, name: "About 1 ft", words: "Low, just off the ground" },
  { inches: 24, name: "About 2 ft", words: "A step or two up" },
  { inches: 36, name: "About 3 ft", words: "A few steps up" },
  { inches: 72, name: "About 6 ft", words: "Over a walk-out" },
  { inches: 108, name: "About 9 ft", words: "Off a second floor" },
];
const HEADROOM: ReadonlyArray<{ inches: number; name: string }> = [
  { inches: 96, name: "8 ft" },
  { inches: 108, name: "9 ft" },
  { inches: 120, name: "10 ft" },
];
const ROOF_STYLES: Record<Structure, RoofKind[]> = {
  deck: [],
  "covered-deck": ["shed", "gable", "hip"],
  gazebo: ["gable", "hip", "pyramid", "double-tier", "gambrel", "dutch-gable"],
  pergola: [],
};
const ROOFINGS: ReadonlyArray<{ id: Roofing; name: string }> = [
  { id: "arch-shingle", name: "Shingles" },
  { id: "cedar-shake", name: "Cedar shakes" },
  { id: "standing-seam", name: "Standing-seam metal" },
  { id: "metal-panel", name: "Metal panels" },
];
const CEILINGS: ReadonlyArray<{ id: CeilingKind; name: string }> = [
  { id: "none", name: "Open rafters" },
  { id: "tongue-groove", name: "Wood ceiling" },
  { id: "beadboard", name: "Beadboard" },
];
const GAZEBO_OUTLINES: ReadonlyArray<{ id: RoofPlanShape; name: string }> = [
  { id: "square", name: "Square" },
  { id: "hexagon", name: "Six sides" },
  { id: "octagon", name: "Eight sides" },
];
const DROPS: ReadonlyArray<{ inches: number; name: string }> = [
  { inches: 7.5, name: "One step down" },
  { inches: 15, name: "Two steps down" },
  { inches: 22.5, name: "Three steps down" },
];
const STAIR_WIDTHS = [3, 4, 5, 6, 8] as const;

/* ── the design, kept sound as it changes ──────────────────────────── */

/**
 * After any change, the house and the deck agree the way they do in the studio: a wall changed → the deck notches
 * itself around a bump-out at its end; a deck resized → the same; a deck shape picked without a resize → the wall
 * gets (or loses) the step that shape means. And a deck that needs a railing gets one back.
 */
function finish(prev: DeckDesign, next: DeckDesign, fallbackRail: RailTypeId): DeckDesign {
  let d = next;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const fitShape = () => {
    const fit = deckShapeForHouse(d.shape, d.house);
    if (!same(fit.shape, d.shape)) d = applyDeckPatch(d, { shape: fit.shape });
  };
  if (!same(prev.house, d.house)) fitShape();
  else if (!same(prev.shape, d.shape)) {
    const resized = prev.shape.widthFt !== d.shape.widthFt || prev.shape.depthFt !== d.shape.depthFt;
    if (resized) fitShape();
    else {
      const h2 = houseForShape(d.house, d.shape);
      if (h2 !== d.house) d = applyDeckPatch(d, { house: h2 });
    }
  }
  if (d.rail.type === "none" && hasDeck(d) && prev.rail.type === d.rail.type && buildStructure(d).rails.required) d = applyDeckPatch(d, { rail: { type: fallbackRail } });
  return d;
}

/** What the client picked, in a few lines, for the review before Send. */
function pickedLines(d: DeckDesign): string[] {
  const out: string[] = [structureWords(d)];
  if (hasDeck(d)) out.push(`${inWords(d.heightIn)} off the ground · ${Math.round(shapeAreaSqFt(d.shape))} sq ft`);
  if (d.placement !== "detached") out.push(`House: ${houseWords(d.house).toLowerCase()}, ${d.house.leftFt + d.shape.widthFt + d.house.rightFt} ft corner to corner`);
  if (hasDeck(d)) {
    out.push(d.stairs.length ? `${d.stairs.length === 1 ? "Stairs" : `${d.stairs.length} sets of stairs`}: ${d.stairs.map((st) => `${STAIR_SIDE_LABEL[st.side].toLowerCase()}, ${ftWords(st.widthFt)} wide`).join("; ")}` : "No stairs");
    out.push(d.rail.type === "none" ? "No railing" : `${RAIL_CHOICES.find((r) => r.id === d.rail.type)?.name ?? railType(d.rail.type).label} railing`);
    const board = BOARD_CHOICES.find((b) => b.key === boardKeyOf(d.decking.product));
    out.push(`${board?.name ?? deckingProduct(d.decking.product).label} boards, ${PATTERNS.find((p) => p.id === d.decking.pattern)?.name.toLowerCase() ?? "straight"}${d.decking.border ? ", with a border" : ""}`);
    if (d.lower.on && d.shape.kind === "rect") out.push(`A lower level, ${ftWords(d.lower.widthFt)} × ${ftWords(d.lower.depthFt)}`);
  }
  if (hasRoof(d)) {
    const r = d.roof;
    if (d.structure === "pergola") out.push(PERGOLA_STYLE_LABEL[r.pergolaStyle]);
    else out.push(`${ROOF_KIND_LABEL[r.kind].split(" — ")[0]} roof, ${ROOFINGS.find((x) => x.id === r.roofing)?.name.toLowerCase() ?? "shingles"}${r.ceiling !== "none" ? `, ${CEILINGS.find((c) => c.id === r.ceiling)?.name.toLowerCase()}` : ""}`);
    if (d.structure === "gazebo" && r.walls.fill !== "none") out.push(WALL_FILL_LABEL[r.walls.fill]);
  }
  // What they lit by talking to it ("add a chandelier and two heaters") goes in the list they send (2026-10-22).
  const lit = litWords(d);
  if (lit.length) out.push(`Lights and extras: ${lit.join(", ")}`);
  return out;
}

/* ── the page ──────────────────────────────────────────────────────── */

export interface DeckClientDesignerProps {
  token: string;
  shop: { name: string; logoUrl: string | null; phone: string | null };
  clientName: string;
  clientPhone: string | null;
  address: string | null;
  start: ClientStart;
  base: DeckDesign;
  work: DeckDesign | null;
  note: string;
  unsure: ClientUnsure[];
  sentAt: string | null;
  /** When the contractor opened what was sent, and when it was priced (2026-10-13): the client's side of the line. */
  seenAt?: string | null;
  pricedAt?: string | null;
  expired: boolean;
  /** The proposal this design became, once the contractor has sent it (2026-10-13): the client's own page. */
  proposal?: { url: string; status: string; sentAt: string | null; acceptedAt: string | null } | null;
  /** ON THE SHOP'S OWN WEBSITE (2026-10-28, actions/webEstimator): nobody knows the visitor yet. The last step shows
   *  the price at the end — the shop's book on what they designed — and "Get my full quote" sends the design and
   *  makes the lead. Null/absent = the contractor's client link, as before. */
  website?: {
    askEmail: boolean;
    leadId: string | null;
    /** The house (2026-10-28): JobFlex's own page — the Lead Center's consent, the email required, the request page after. */
    house?: boolean;
    price: (design: DeckDesign) => Promise<{ ok: true; words: string; summary: string; show: "range" | "exact"; basis: string } | { ok: false; error: string }>;
    send: (input: { design: DeckDesign; note: string; name: string; phone: string; email: string; consent: boolean; company: string }) => Promise<{ ok: true; at: string; leadId: string; next?: string } | { ok: false; error: string }>;
  } | null;
}

export function DeckClientDesigner(props: DeckClientDesignerProps) {
  const { token, shop, base, start, expired } = props;
  const shopName = shop.name || "your contractor";
  // The house (the homeowner portal, /homeowner/price/deck, owner 2026-10-28): JobFlex passes the design on — a local JobFlex pro measures, quotes, builds.
  const pro = props.website?.house ? PRO : shopName;
  const first = props.clientName.trim().split(/\s+/)[0] || "";
  const [design, setDesign] = React.useState<DeckDesign>(() => props.work ?? base);
  const dirty = React.useRef(false);
  const history = React.useRef<{ list: DeckDesign[]; at: number }>({ list: [], at: 0 });
  const [canUndo, setCanUndo] = React.useState(false);
  const fallbackRail: RailTypeId = base.rail.type !== "none" && base.rail.type !== "custom" ? base.rail.type : "treated";

  /** Every change goes through here: the house and the railing kept sound, the step kept for Undo, the save started. */
  const change = React.useCallback(
    (next: DeckDesign) => {
      if (next === design) return;
      // A drag sends many small changes; one Undo takes back the whole drag.
      const now = performance.now();
      if (now - history.current.at > 700) history.current.list = [...history.current.list.slice(-29), design];
      history.current.at = now;
      dirty.current = true;
      setCanUndo(true);
      setDesign(finish(design, next, fallbackRail));
    },
    [design, fallbackRail],
  );
  const patch = (p: Parameters<typeof applyDeckPatch>[1]) => change(applyDeckPatch(design, p));
  const roofPatch = (p: Partial<RoofDesign>) => change(applyDeckPatch(design, { roof: { ...design.roof, ...p } }));
  const undo = () => {
    const prev = history.current.list.pop();
    if (!prev) return;
    history.current.at = 0;
    dirty.current = true;
    setCanUndo(history.current.list.length > 0);
    setDesign(prev);
  };
  const startOver = () => {
    if (!window.confirm(start === "mine" ? `Go back to ${shopName}'s design? Your changes will be undone.` : "Start over from a blank deck?")) return;
    change(base);
    setApplied(null);
  };

  const structure: DeckStructure = React.useMemo(() => buildStructure(design), [design]);
  const scene = React.useMemo(() => {
    const full = deckScene(structure);
    return { ...full, handles: full.handles.filter((h) => CLIENT_HANDLES.has(h.kind)) };
  }, [structure]);
  const withDeck = hasDeck(design);
  const withRoof = hasRoof(design);
  const what = structureWords(design);
  const railsRequired = structure.rails.required;

  /* ── saving as they go ── */
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "failed">(props.work ? "saved" : "idle");
  React.useEffect(() => {
    void markDeckClientOpened(token);
  }, [token]);
  React.useEffect(() => {
    if (!dirty.current || expired) return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      try {
        localStorage.setItem(`jf-deck-client:${token}`, JSON.stringify({ design, at: Date.now() }));
      } catch {
        /* the server copy is the one that counts */
      }
      const res = await saveDeckClientWork(token, design);
      setSaveState(res.ok ? "saved" : "failed");
    }, 1200);
    return () => clearTimeout(t);
  }, [design, token, expired]);

  /* ── the 3D: knobs, stairs by a tap, the build-up ── */
  const [editing, setEditing] = React.useState(false);
  const [placing, setPlacing] = React.useState(false);
  const [resetToken, setResetToken] = React.useState(0);
  const [talking, setTalking] = React.useState(false);
  // What the voice shows (2026-10-22): the evening with the lights on, a side or the top, the part just changed —
  // "show me at night" said "the lights on" here while the 3D stayed in the day.
  const [night, setNight] = React.useState(false);
  const [look, setLook] = React.useState<{ token: number; from: DeckLook } | null>(null);
  const [focus, setFocus] = React.useState<[number, number, number, number] | null>(null);
  const [voiceFocus, setVoiceFocus] = React.useState<FieldFocus | null>(null);
  const voiceLit = React.useMemo<SceneHighlight | null>(() => (voiceFocus ? fieldLight(scene, structure, voiceFocus) : null), [voiceFocus, scene, structure]);
  // The part just changed is lit for a moment, then shown as it is: "dark gray boards" wants to be seen dark gray.
  React.useEffect(() => {
    if (!voiceFocus) return;
    const t = window.setTimeout(() => setVoiceFocus(null), 2400);
    return () => window.clearTimeout(t);
  }, [voiceFocus]);
  const layers = React.useMemo(() => sceneBuildLayers(scene).length, [scene]);
  const [built, setBuilt] = React.useState<number>(Number.POSITIVE_INFINITY);
  const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now();
    const seconds = layers > 12 ? 9 : 6;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / (seconds * 1000));
      setBuilt(t * layers);
      if (t < 1) raf = requestAnimationFrame(step);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, layers]);
  const play = () => {
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduced = false;
    }
    if (reduced) {
      setBuilt(Number.POSITIVE_INFINITY);
      return;
    }
    setBuilt(0);
    setPlaying(true);
  };

  const onEdit = React.useCallback(
    (e: DeckEdit) => {
      const d = design;
      const polygon = isPolygonShape(d.roof.plan.shape);
      switch (e.kind) {
        case "width":
          change(applyDeckPatch(d, { shape: { ...d.shape, widthFt: clamp(half(e.value), DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max) } }));
          break;
        case "depth":
          change(applyDeckPatch(d, { shape: { ...d.shape, depthFt: clamp(half(e.value), DECK_LIMITS.depthFt.min, DECK_LIMITS.depthFt.max) } }));
          break;
        case "height":
          change(applyDeckPatch(d, { heightIn: clamp(Math.round(e.value), DECK_LIMITS.heightIn.min, DECK_LIMITS.heightIn.max) }));
          break;
        case "eave":
          change(applyDeckPatch(d, { roof: { ...d.roof, eaveHeightIn: clamp(Math.round(e.value), ROOF_LIMITS.eaveHeightIn.min, ROOF_LIMITS.eaveHeightIn.max) } }));
          break;
        case "lower-depth":
          change(applyDeckPatch(d, { lower: { depthFt: clamp(half(e.value), LOWER_LIMITS.depthFt.min, LOWER_LIMITS.depthFt.max) } }));
          break;
        case "roof-width": {
          const v = half(e.value);
          const plan = polygon
            ? { ...d.roof.plan, acrossFt: clamp(v, ROOF_LIMITS.acrossFt.min, ROOF_LIMITS.acrossFt.max) }
            : { ...d.roof.plan, widthFt: clamp(v, ROOF_LIMITS.planFt.min, ROOF_LIMITS.planFt.max), depthFt: d.roof.plan.shape === "square" ? clamp(v, ROOF_LIMITS.planFt.min, ROOF_LIMITS.planFt.max) : d.roof.plan.depthFt };
          change(applyDeckPatch(d, { roof: { ...d.roof, plan } }));
          break;
        }
        case "roof-depth":
          change(applyDeckPatch(d, { roof: { ...d.roof, plan: { ...d.roof.plan, depthFt: clamp(half(e.value), ROOF_LIMITS.planFt.min, ROOF_LIMITS.planFt.max) } } }));
          break;
        case "stair":
          change(applyDeckPatch(d, { stairs: d.stairs.map((st) => (st.id === e.id ? { ...st, atFt: Math.max(st.widthFt / 2, half(e.value)) } : st)) }));
          break;
        case "stair-width": {
          const w2 = clamp(half(e.value), STAIR_LIMITS.widthFt.min, STAIR_LIMITS.widthFt.max);
          change(applyDeckPatch(d, { stairs: d.stairs.map((st) => (st.id === e.id ? { ...st, widthFt: w2, atFt: Math.max(w2 / 2, Math.round((st.atFt + (w2 - st.widthFt) / 2) * 4) / 4) } : st)) }));
          break;
        }
        case "pitch":
          change(applyDeckPatch(d, { roof: { ...d.roof, pitch: clamp(Math.round(e.value), ROOF_LIMITS.pitch.min, ROOF_LIMITS.pitch.max) } }));
          break;
        case "jog":
          change(applyDeckPatch(d, { house: moveJogTo(d.house, d.shape, e.id, e.value) }));
          break;
        case "house-left":
          change(applyDeckPatch(d, { house: { leftFt: clamp(-half(e.value), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max) } }));
          break;
        case "house-right":
          change(applyDeckPatch(d, { house: { rightFt: clamp(half(e.value) - d.shape.widthFt, HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max) } }));
          break;
      }
    },
    [design, change],
  );

  /** Stairs where the deck's edge is nearest a point of the plan (inches). */
  const stairAt = React.useCallback(
    (xIn: number, yIn: number) => {
      if (design.stairs.length >= STAIR_LIMITS.count) return;
      const hit = nearestStairEdge(structure, xIn, yIn, Number.POSITIVE_INFINITY);
      if (!hit) return;
      const id = `c${design.stairs.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
      change(applyDeckPatch(design, { stairs: [...design.stairs, { ...defaultStair(id, hit.side, hit.atFt), level: hit.level }] }));
    },
    [design, structure, change],
  );
  const onPick = React.useCallback(
    (pick: DeckPick | null, kind: "hover" | "click") => {
      if (kind !== "click" || !placing || !pick) return;
      stairAt(pick.point[0] * 12, pick.point[1] * 12);
      setPlacing(false);
    },
    [placing, stairAt, setPlacing],
  );
  const W = design.shape.widthFt;
  const D = design.shape.depthFt;
  const sideMid: Record<StairSide, [number, number]> = { front: [W * 6, D * 12 + 12], left: [-12, D * 6], right: [W * 12 + 12, D * 6] };
  const moveStair = (id: string, side: StairSide) => {
    const hit = nearestStairEdge(structure, sideMid[side][0], sideMid[side][1], Number.POSITIVE_INFINITY);
    patch({ stairs: design.stairs.map((st) => (st.id === id ? { ...st, side: hit?.side ?? side, atFt: hit?.atFt ?? st.atFt, level: hit?.level ?? st.level } : st)) });
  };

  /* ── a kind or a sample to start from ── */
  const [applied, setApplied] = React.useState<{ id: string; design: DeckDesign } | null>(null);
  const [showKinds, setShowKinds] = React.useState(start === "blank" && !props.work);
  const applySample = (sample: DeckSample) => {
    const next = finish(design, applyDeckPatch(design, sample.patch), fallbackRail);
    change(next);
    setApplied({ id: sample.id, design: next });
  };

  /* ── sending ── */
  const [note, setNote] = React.useState(props.note);
  const [name, setName] = React.useState(props.clientName === "Your client" ? "" : props.clientName);
  const [phone, setPhone] = React.useState(props.clientPhone ?? "");
  const [unsureHeight, setUnsureHeight] = React.useState(props.unsure.includes("height"));
  const [sent, setSent] = React.useState<{ at: string; design: DeckDesign } | null>(props.sentAt ? { at: props.sentAt, design } : null);
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const changedSinceSent = !!sent && sent.design !== design;
  /* ── the website's last step: the price at the end, then the full quote ── */
  const [email, setEmail] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [company, setCompany] = React.useState("");
  const [pricing, setPricing] = React.useState(false);
  const [priceError, setPriceError] = React.useState<string | null>(null);
  const [priced, setPriced] = React.useState<{ for: DeckDesign; words: string; summary: string; show: "range" | "exact"; basis: string } | null>(null);
  const [sentLeadId, setSentLeadId] = React.useState<string | null>(null);
  const seePrice = async () => {
    if (!props.website) return;
    setPricing(true);
    setPriceError(null);
    const r = await props.website.price(design);
    setPricing(false);
    if (r.ok) setPriced({ for: design, words: r.words, summary: r.summary, show: r.show, basis: r.basis });
    else setPriceError(r.error);
  };
  const send = async () => {
    if (props.website) {
      if (!name.trim()) { setSendError("Your name, please."); document.getElementById("client-name")?.focus(); return; }
      if (phone.replace(/\D/g, "").length < 10) { setSendError(`A phone number ${pro} can reach you at, please.`); return; }
      if (props.website.house && !email.trim()) { setSendError("Your email, please — your request page and your dashboard are sent there."); return; }
      if (!consent) { setSendError(props.website.house ? `Tick the box so ${PRO} may contact you.` : `Tick the box so ${shopName} may contact you.`); return; }
      setSending(true);
      setSendError(null);
      const res = await props.website.send({ design, note, name, phone, email, consent, company });
      setSending(false);
      if (res.ok && res.next) { window.location.assign(res.next); return; }   // the house: the homeowner's own request page
      if (res.ok) { setSent({ at: res.at, design }); setSentLeadId(res.leadId); setSaveState("saved"); } else setSendError(res.error);
      return;
    }
    if (!name.trim()) {
      setSendError("Type your name so " + shopName + " knows whose design it is.");
      document.getElementById("client-name")?.focus();
      return;
    }
    setSending(true);
    setSendError(null);
    const res = await sendDeckClientDesign(token, { design, note, name, phone, unsure: unsureHeight ? ["height"] : [] });
    setSending(false);
    if (res.ok) {
      setSent({ at: res.at, design });
      setSaveState("saved");
    } else setSendError(res.error);
  };
  const toSend = () => document.getElementById("step-send")?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (expired) {
    return (
      <main className={s.page}>
        <div className={s.closed}>
          <div className={s.brand}>{shopName}</div>
          <h1 className={s.h1}>This design link has closed</h1>
          <p className={s.lead}>Ask {shopName} for a new one{shop.phone ? <> — call or text <a href={`tel:${shop.phone}`}>{shop.phone}</a></> : null}.</p>
        </div>
      </main>
    );
  }

  let n = 0;
  const next = () => ++n;
  const roofStyles = ROOF_STYLES[design.structure];
  const r = design.roof;
  const polygon = isPolygonShape(r.plan.shape);
  const lowerPossible = withDeck && design.shape.kind === "rect" && design.shape.front?.kind !== "curve" && design.heightIn > LOWER_LIMITS.dropIn.min + 4 && (design.structure === "deck" || design.structure === "covered-deck");
  const needsStairs = withDeck && design.heightIn >= 8 && design.stairs.length === 0 && design.placement !== "detached";
  const shapeNow = shapeKey(design.shape);
  const boardNow = boardKeyOf(design.decking.product);
  const stateCode = design.site.state;

  /** The voice panel's doors on the client's page: the same change() as a tap, the client's own Undo and Start over. */
  const voiceHost: DeckVoiceHost = {
    design,
    readOnly: expired,
    env: {},
    apply: (next) => change(next),
    view: (v) => {
      if (v.night !== undefined) setNight(v.night);
      if (v.build === "play") play();
      if (v.reset) {
        setResetToken((t) => t + 1);
        setFocus(null);
      }
      const from = v.look;
      if (from) setLook((l) => ({ token: (l?.token ?? 0) + 1, from }));
    },
    light: (f, flyThere) => {
      setVoiceFocus(f);
      if (f && flyThere) {
        const lit = fieldLight(scene, structure, f);
        if (lit?.tag) setFocus([lit.tag.x, lit.tag.y, Math.max(0.5, lit.tag.z - 1.4), 9]);
      }
    },
    fly: (p) => setFocus([p[0], p[1], p[2], 11]),
    flash: () => {},
    link: () => null,
    go: () => {},
    name: () => {},
    address: () => {},
    save: () => {},
    reset: () => change(base),
    audience: "client",
    token,
    // "Add a fire pit": written into the note that goes with their design, once.
    note: (line) => setNote((n) => (n.toLowerCase().includes(line.toLowerCase()) ? n : (n.trim() ? `${n.trim()}\n${line}` : line).slice(0, CLIENT_NOTE_MAX))),
  };

  return (
    <main className={cx(s.page, "jf-blueprint")} data-deck-client>
      <div className={cx("content", s.content)}>
        <header className={`${s.top} ${props.website && !props.website.house ? s.topWeb : ""}`}>
          {/* The house (2026-10-28): in the homeowner portal, under the portal's own bar — no second brand row. */}
          {props.website?.house ? (
            <span className={s.byJf}><b>Deck Studio</b></span>
          ) : (
            <div className={`${s.brand} ${props.website ? s.brandWeb : ""}`}>
              {shop.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- the shop's own logo, any host.
                <img src={shop.logoUrl} alt={shopName} className={props.website ? s.logoWeb : s.logo} />
              ) : (
                <span className={s.mark} aria-hidden="true">{shopName.slice(0, 1).toUpperCase()}</span>
              )}
              <span>{shopName}</span>
            </div>
          )}
          <div className={s.topRight}>
            {/* The shop's brand leads on its own website; JobFlex is the small mark under it (owner, 2026-10-28). */}
            {props.website && !props.website.house ? <span className={s.byJf} aria-label="Deck Studio by JobFlex"><b>Deck Studio</b> by JobFlex</span> : null}
            <span className={s.saveState} data-client-save={saveState} aria-live="polite">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "failed" ? "Not saved — will retry" : "Saves as you go"}
            </span>
          </div>
        </header>

        <div className={s.intro}>
          <h1 className={s.h1}>{first ? `${first}, design your ${hasRoof(design) && !withDeck ? design.structure : "deck"}` : "Design your deck"}</h1>
          <p className={s.lead}>
            {props.website ? <>Design it here in 3D — the size, the stairs, the railing, the boards, a roof if you like. See the price at the end, and {pro} sends the full quote.</> : start === "mine" ? <>This is the design {shopName} drew{props.address ? <> for <b>{props.address}</b></> : null}. Change anything you like — the size, the stairs, the railing, the boards — and press <b>Send</b> when it looks right.</> : <>Pick what you&apos;d like, set its size, stairs, railing and boards{props.address ? <> for <b>{props.address}</b></> : null}, and press <b>Send</b>. {shopName} checks it against the building code and sends you the price.</>}
          </p>
        </div>

        <div className={s.layout}>
          <div className={s.viewCol}>
            <div className={s.viewer} data-client-viewer>
              <DeckModel3D scene={scene} built={built} edit={editing} onEdit={onEdit} placing={placing} onPick={onPick} resetToken={resetToken} viewControls="top-right" night={night} look={look} focus={focus} highlight={voiceLit} className={s.canvas} label={`Your design in 3D: ${scene.facts}`} />
              {/* Talk to design (2026-10-21, owner): the client says what they want; the studio changes the design and
                  answers in words — no price, no numbers — with a quick next idea. */}
              {talking ? (
                <DeckVoice host={voiceHost} onClose={() => setTalking(false)} />
              ) : !expired ? (
                <button type="button" className="dv-open" onClick={() => setTalking(true)} data-client-talk>
                  <Mic size={18} aria-hidden="true" /> Talk to design
                </button>
              ) : null}
              {placing ? (
                <div className={s.banner} data-client-placing>
                  <span>Tap the edge of the deck where the stairs should go.</span>
                  <button type="button" className={s.bannerBtn} onClick={() => setPlacing(false)}>Cancel</button>
                </div>
              ) : editing ? (
                <div className={s.banner} data-client-editing>
                  <span>Drag the blue knobs: the deck&apos;s size, height and stairs — and your house&apos;s corners and the steps in its wall.</span>
                  <button type="button" className={s.bannerBtn} onClick={() => setEditing(false)}>Done</button>
                </div>
              ) : null}
            </div>
            <div className={s.tools} role="toolbar" aria-label="3D tools">
              <button type="button" className={cx(s.tool, editing && s.toolOn)} aria-pressed={editing} onClick={() => { setPlacing(false); setEditing((v) => !v); }} data-client-tool="drag">↔ Drag to resize</button>
              {withDeck ? <button type="button" className={cx(s.tool, placing && s.toolOn)} aria-pressed={placing} disabled={design.stairs.length >= STAIR_LIMITS.count} onClick={() => { setEditing(false); setPlacing((v) => !v); }} data-client-tool="stairs">+ Stairs</button> : null}
              <button type="button" className={s.tool} onClick={play} disabled={playing}>▶ Watch it build</button>
              <button type="button" className={s.tool} onClick={() => { setResetToken((t) => t + 1); setFocus(null); }}>⟲ View</button>
              {night || design.electrical.fixtures.length ? (
                <button type="button" className={cx(s.tool, night && s.toolOn)} aria-pressed={night} onClick={() => setNight((v) => !v)} data-client-tool="night">{night ? "☀ Day" : "☾ Night"}</button>
              ) : null}
              <button type="button" className={s.tool} onClick={undo} disabled={!canUndo} data-client-tool="undo">↶ Undo</button>
            </div>
            <p className={s.facts}>{what}{withDeck ? ` · ${Math.round(shapeAreaSqFt(design.shape))} sq ft · ${inWords(design.heightIn)} high` : ""}</p>
          </div>

          <div className={s.controls}>
            <Section
              n={next()}
              id="step-kind"
              title="What would you like?"
              sub={start === "mine" && !showKinds ? <>You are changing {shopName}&apos;s design. Want something different?</> : "Tap a picture to start from it — then change anything below."}
            >
              {showKinds ? (
                <DeckKindPicker
                  structure={design.structure}
                  onPickKind={(st) => (st === design.structure ? undefined : applySample(kindSample(st)))}
                  onPickSample={applySample}
                  appliedSampleId={applied && applied.design === design ? applied.id : null}
                  hint="Tap one to start from it; every size and choice can still be changed."
                />
              ) : (
                <button type="button" className={s.ghostBtn} onClick={() => setShowKinds(true)} data-client-show-kinds>
                  See other ideas — decks, covered decks, gazebos, pergolas
                </button>
              )}
              <div className={s.rowEnd}>
                <button type="button" className={s.linkBtn} onClick={startOver}>{start === "mine" ? `Back to ${shopName}'s design` : "Start over"}</button>
              </div>
            </Section>

            {design.placement !== "detached" ? (
              <Section n={next()} id="step-house" title="Your house's back wall" sub={<>Build it from a photo of the wall, or pick its shape and how your house looks. Measuring it is optional — the deck fits itself around the corners you add.</>}>
                <ClientHousePhoto token={token} design={design} patch={patch} />
                <ClientHouse shape={design.shape} house={design.house} shopName={pro}onChange={(n2) => change(applyDeckPatch(design, { ...(n2.house ? { house: n2.house } : {}), ...(n2.shape ? { shape: n2.shape } : {}) }))} />
              </Section>
            ) : null}

            <Section n={next()} id="step-size" title="Size and shape" sub={withDeck ? (design.placement === "detached" ? "Width and depth of the deck." : "Width runs along the house; depth goes out into the yard.") : "How big it is on the ground."}>
              {withDeck ? (
                <>
                  <div className={s.shapes} role="radiogroup" aria-label="Shape">
                    {SHAPES.map((sh) => {
                      const on = sh.key === shapeNow;
                      const off = (sh.key === "L-left" || sh.key === "L-right") && (W < 8 || D < 8);
                      return (
                        <button key={sh.key} type="button" role="radio" aria-checked={on} disabled={off} className={cx(s.shape, on && s.shapeOn)} onClick={() => patch({ shape: shapeFor(sh.key, W, D, design.shape) })} data-client-shape={sh.key}>
                          <svg viewBox="0 0 40 34" aria-hidden="true" className={s.shapeIcon}>
                            <rect x="2" y="1" width="36" height="4" className={s.shapeHouse} />
                            <path d={sh.path} className={s.shapePath} />
                          </svg>
                          <span>{sh.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  {shapeNow === "L-back" ? <p className={s.hint}>The deck steps around a part of the house that sticks out — {shopName} set that up.</p> : null}
                  <div className={s.grid2}>
                    <Stepper label="Width" data="width" value={W} min={DECK_LIMITS.widthFt.min} max={DECK_LIMITS.widthFt.max} words={ftWords} onChange={(v) => patch({ shape: { ...design.shape, widthFt: v } })} />
                    <Stepper label="Depth" data="depth" value={D} min={DECK_LIMITS.depthFt.min} max={DECK_LIMITS.depthFt.max} words={ftWords} onChange={(v) => patch({ shape: { ...design.shape, depthFt: v } })} />
                  </div>
                  <p className={s.hint}>{Math.round(shapeAreaSqFt(design.shape))} sq ft. A dining table for six needs about 12 × 12 ft; a grill and a lounge corner add 4–6 ft.</p>
                </>
              ) : polygon ? (
                <Stepper label="Across" data="across" value={r.plan.acrossFt} min={ROOF_LIMITS.acrossFt.min} max={ROOF_LIMITS.acrossFt.max} words={ftWords} onChange={(v) => roofPatch({ plan: { ...r.plan, acrossFt: v } })} />
              ) : (
                <div className={s.grid2}>
                  <Stepper label={r.plan.shape === "square" ? "Each side" : "Width"} data="roof-width" value={r.plan.widthFt} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} words={ftWords} onChange={(v) => roofPatch({ plan: { ...r.plan, widthFt: v, depthFt: r.plan.shape === "square" ? v : r.plan.depthFt } })} />
                  {r.plan.shape === "rect" ? <Stepper label="Depth" data="roof-depth" value={r.plan.depthFt} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} words={ftWords} onChange={(v) => roofPatch({ plan: { ...r.plan, depthFt: v } })} /> : null}
                </div>
              )}
            </Section>

            {withDeck ? (
              <Section n={next()} id="step-height" title="How high off the ground" sub="Measure from the ground to the floor inside the door the deck comes off — or pick the closest.">
                <Chips label="Height" value={HEIGHTS.find((h) => Math.abs(h.inches - design.heightIn) < 1)?.inches ?? null} options={HEIGHTS.map((h) => ({ value: h.inches, name: h.name, words: h.words }))} onChange={(v) => patch({ heightIn: v })} />
                <div className={s.grid2}>
                  <Stepper label="Height, inches" data="height" value={Math.round(design.heightIn)} min={DECK_LIMITS.heightIn.min} max={DECK_LIMITS.heightIn.max} step={2} words={inWords} onChange={(v) => patch({ heightIn: v })} />
                </div>
                <label className={s.check}>
                  <input type="checkbox" checked={unsureHeight} onChange={(e) => setUnsureHeight(e.target.checked)} />
                  <span>I&apos;m not sure — {pro} will measure it</span>
                </label>
              </Section>
            ) : null}

            {withRoof && design.structure !== "pergola" ? (
              <Section n={next()} id="step-roof" title="The roof" sub="Its shape, what covers it, and what you see from underneath.">
                {design.structure === "gazebo" ? (
                  <>
                    <div className={s.lbl}>Outline</div>
                    <Chips label="Outline" value={r.plan.shape} options={[...(withDeck ? [{ value: "follows-deck" as RoofPlanShape, name: "Same as the deck" }] : []), ...GAZEBO_OUTLINES.map((o) => ({ value: o.id, name: o.name }))]} onChange={(v) => roofPatch({ plan: { ...r.plan, shape: v } })} />
                  </>
                ) : null}
                {roofStyles.length ? (
                  <>
                    <div className={s.lbl}>Style</div>
                    <Chips label="Roof style" value={r.kind} options={roofStyles.map((k) => ({ value: k, name: ROOF_KIND_LABEL[k] }))} onChange={(v) => roofPatch({ kind: v })} />
                  </>
                ) : null}
                <div className={s.lbl}>Roofing</div>
                <Chips label="Roofing" value={r.roofing} options={ROOFINGS.map((x) => ({ value: x.id, name: x.name }))} onChange={(v) => roofPatch({ roofing: v })} />
                <div className={s.lbl}>Underneath</div>
                <Chips label="Ceiling" value={r.ceiling} options={CEILINGS.map((x) => ({ value: x.id, name: x.name }))} onChange={(v) => roofPatch({ ceiling: v })} />
                {design.structure === "gazebo" ? (
                  <>
                    <div className={s.lbl}>Between the posts</div>
                    <Chips label="Between the posts" value={r.walls.fill} options={(Object.keys(WALL_FILL_LABEL) as WallFill[]).map((w) => ({ value: w, name: WALL_FILL_LABEL[w] }))} onChange={(v) => roofPatch({ walls: { ...r.walls, fill: v } })} />
                  </>
                ) : null}
                <div className={s.lbl}>Headroom</div>
                <Chips label="Headroom" value={HEADROOM.find((h) => h.inches === r.eaveHeightIn)?.inches ?? null} options={HEADROOM.map((h) => ({ value: h.inches, name: h.name }))} onChange={(v) => roofPatch({ eaveHeightIn: v })} />
                {withDeck && r.plan.shape !== "follows-deck" && !polygon ? (
                  <div className={s.grid2}>
                    <Stepper label="Roof width" value={r.plan.widthFt} min={ROOF_LIMITS.planFt.min} max={ROOF_LIMITS.planFt.max} words={ftWords} onChange={(v) => roofPatch({ plan: { ...r.plan, widthFt: v, depthFt: r.plan.shape === "square" ? v : r.plan.depthFt } })} />
                  </div>
                ) : withDeck && polygon ? (
                  <div className={s.grid2}>
                    <Stepper label="Roof across" value={r.plan.acrossFt} min={ROOF_LIMITS.acrossFt.min} max={ROOF_LIMITS.acrossFt.max} words={ftWords} onChange={(v) => roofPatch({ plan: { ...r.plan, acrossFt: v } })} />
                  </div>
                ) : null}
              </Section>
            ) : null}

            {design.structure === "pergola" ? (
              <Section n={next()} id="step-pergola" title="The pergola's top" sub="Open slats for shade, louvers you can turn, or arched rafters.">
                <Chips label="Pergola top" value={r.pergolaStyle} options={(Object.keys(PERGOLA_STYLE_LABEL) as PergolaStyle[]).map((p) => ({ value: p, name: PERGOLA_STYLE_LABEL[p] }))} onChange={(v) => roofPatch({ pergolaStyle: v })} />
                <div className={s.lbl}>Headroom</div>
                <Chips label="Headroom" value={HEADROOM.find((h) => h.inches === r.eaveHeightIn)?.inches ?? null} options={HEADROOM.map((h) => ({ value: h.inches, name: h.name }))} onChange={(v) => roofPatch({ eaveHeightIn: v })} />
              </Section>
            ) : null}

            {withDeck ? (
              <Section n={next()} id="step-stairs" title="Stairs" sub="Where you walk down to the yard. Tap + Stairs on the 3D and then the edge, or use the buttons.">
                {needsStairs ? (
                  <div className={s.tip} data-client-tip="stairs">
                    <span>At {inWords(design.heightIn)} up you will want stairs down to the yard.</span>
                    <button type="button" className={s.tipBtn} onClick={() => stairAt(sideMid.front[0], sideMid.front[1])}>Add stairs on the front</button>
                  </div>
                ) : null}
                {design.stairs.map((st, i) => {
                  const risers = structure.stairs.find((b) => b.design.id === st.id)?.risers ?? 0;
                  return (
                  <div key={st.id} className={s.stair} data-client-stair={st.id}>
                    <div className={s.stairHead}>
                      <b>Stairs {i + 1}</b>
                      <span className={s.stairFacts}>{risers > 0 ? `${risers} ${risers === 1 ? "step" : "steps"} down` : ""}</span>
                      <button type="button" className={s.removeBtn} onClick={() => patch({ stairs: design.stairs.filter((x) => x.id !== st.id) })} aria-label={`Remove stairs ${i + 1}`}>Remove</button>
                    </div>
                    <div className={s.lbl}>Side</div>
                    <Chips label={`Stairs ${i + 1} side`} value={st.side} options={(["front", "left", "right"] as StairSide[]).map((sd) => ({ value: sd, name: STAIR_SIDE_LABEL[sd] }))} onChange={(v) => moveStair(st.id, v)} />
                    <div className={s.lbl}>Width</div>
                    <Chips label={`Stairs ${i + 1} width`} value={STAIR_WIDTHS.find((w) => w === st.widthFt) ?? null} options={STAIR_WIDTHS.map((w) => ({ value: w, name: `${w} ft` }))} onChange={(v) => patch({ stairs: design.stairs.map((x) => (x.id === st.id ? { ...x, widthFt: v, atFt: Math.max(v / 2, x.atFt) } : x)) })} />
                  </div>
                  );
                })}
                {design.stairs.length < STAIR_LIMITS.count ? (
                  <div className={s.addRow}>
                    <span className={s.lbl}>Add stairs</span>
                    {(["front", "left", "right"] as StairSide[]).map((sd) => (
                      <button key={sd} type="button" className={s.ghostBtn} onClick={() => stairAt(sideMid[sd][0], sideMid[sd][1])} data-client-add-stair={sd}>+ {STAIR_SIDE_LABEL[sd]}</button>
                    ))}
                  </div>
                ) : null}
              </Section>
            ) : null}

            {withDeck ? (
              <Section n={next()} id="step-rail" title="Railing" sub={railsRequired ? <>At this height the building code requires a railing — pick its style.</> : "Optional at this height — your call."}>
                <Chips
                  label="Railing"
                  value={design.rail.type}
                  options={RAIL_CHOICES.map((c) => ({ value: c.id, name: c.name, words: c.words }))}
                  disabled={(v) => v === "none" && railsRequired}
                  onChange={(v) => patch({ rail: { type: v, infill: "auto" } })}
                />
                {railColors(design.rail.type).length ? (
                  <>
                    <div className={s.lbl}>{design.rail.type === "cable" || design.rail.type === "glass" ? "Frame colour" : "Rail colour"}</div>
                    <Chips label="Rail colour" value={railColorOf(design.rail.type, design.rail.color)?.id ?? ""} options={railColors(design.rail.type).map((c) => ({ value: c.id, name: c.name, swatch: c.hex }))} onChange={(v) => patch({ rail: { color: v } })} />
                  </>
                ) : null}
              </Section>
            ) : null}

            {withDeck ? (
              <Section n={next()} id="step-boards" title="Deck boards" sub="What you walk on. Colours are close; ask for samples.">
                <div className={s.boards} role="radiogroup" aria-label="Deck boards">
                  {BOARD_CHOICES.map((b) => {
                    const on = b.key === boardNow;
                    const product = b.product(stateCode, design.decking.product);
                    const color = deckingProduct(product).color;
                    return (
                      <button key={b.key} type="button" role="radio" aria-checked={on} className={cx(s.board, on && s.boardOn)} onClick={() => patch({ decking: { product } })} data-client-board={b.key}>
                        <span className={s.swatch} style={{ "--wood": color } as React.CSSProperties} aria-hidden="true" />
                        <span className={s.boardName}>{b.name}</span>
                        <span className={s.boardWords}>{b.words}</span>
                      </button>
                    );
                  })}
                </div>
                {boardNow === null ? <p className={s.hint}>Now: {deckingProduct(design.decking.product).label} — {shopName}&apos;s pick.</p> : null}
                {/* The line's own colours (2026-11-09): the one picked is the one drawn, priced and ordered. */}
                {deckingColors(design.decking.product).length && !design.custom.decking ? (
                  <>
                    <div className={s.lbl}>Colour — {deckingProduct(design.decking.product).label}</div>
                    <div className={s.boards} role="radiogroup" aria-label="Board colour">
                      {deckingColors(design.decking.product).map((c) => {
                        const on = !design.decking.ownColor && design.decking.color === c.id;
                        return (
                          <button key={c.id} type="button" role="radio" aria-checked={on} className={cx(s.board, on && s.boardOn)} onClick={() => patch({ decking: { color: c.id } })} data-client-color={c.id}>
                            <span className={s.swatch} style={{ "--wood": c.hex } as React.CSSProperties} aria-hidden="true" />
                            <span className={s.boardName}>{c.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : null}
                <div className={s.lbl}>Pattern</div>
                <Chips label="Board pattern" value={design.decking.pattern} options={PATTERNS.map((p) => ({ value: p.id, name: p.name }))} onChange={(v) => patch({ decking: { pattern: v, diagonal: v === "diagonal" } })} />
                <div className={s.lbl}>Border</div>
                <Chips label="Border" value={design.decking.border > 0 ? 1 : 0} options={[{ value: 0, name: "No border" }, { value: 1, name: "Picture-frame border" }]} onChange={(v) => patch({ decking: { border: v === 1 ? 1 : 0 } })} />
              </Section>
            ) : null}

            {lowerPossible || design.lower.on ? (
              <Section n={next()} id="step-lower" title="A lower level" sub="A second, lower deck in front — a step or two down from the main one.">
                <Chips label="Lower level" value={design.lower.on ? 1 : 0} options={[{ value: 0, name: "One level" }, { value: 1, name: "Add a lower level" }]} onChange={(v) => patch({ lower: v === 1 ? { ...defaultLowerLevel(), widthFt: Math.min(W, defaultLowerLevel().widthFt), on: true } : { on: false } })} />
                {design.lower.on ? (
                  <>
                    <div className={s.grid2}>
                      <Stepper label="Lower width" data="lower-width" value={design.lower.widthFt} min={LOWER_LIMITS.widthFt.min} max={LOWER_LIMITS.widthFt.max} words={ftWords} onChange={(v) => patch({ lower: { widthFt: v } })} />
                      <Stepper label="Lower depth" data="lower-depth" value={design.lower.depthFt} min={LOWER_LIMITS.depthFt.min} max={LOWER_LIMITS.depthFt.max} words={ftWords} onChange={(v) => patch({ lower: { depthFt: v } })} />
                    </div>
                    <Chips label="How far down" value={DROPS.find((x) => x.inches === design.lower.dropIn)?.inches ?? null} options={DROPS.map((x) => ({ value: x.inches, name: x.name }))} onChange={(v) => patch({ lower: { dropIn: v } })} />
                  </>
                ) : null}
              </Section>
            ) : null}

            {props.website ? (
              <Section n={next()} id="step-send" title="Your price, then the full quote" sub={`See the price for what you designed, then leave your details — ${pro} sends the full, line-by-line quote.`}>
                <ul className={s.summary} data-client-summary>
                  {pickedLines(design).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                {priced && priced.for === design ? (
                  <div className={s.webPrice} data-web-band>
                    <div className={s.webPriceKicker}>{priced.show === "exact" ? "Your estimated price" : "Your estimated price range"}</div>
                    <div className={s.webPriceBig}>{priced.words}</div>
                    <div className={s.webPriceBasis}>{priced.basis}</div>
                    <p className={s.webPriceSum}>{priced.summary}</p>
                  </div>
                ) : (
                  <button type="button" className={s.sendBtn} onClick={() => void seePrice()} disabled={pricing} data-web-run>
                    {pricing ? "Pricing…" : priced ? "The design changed — price it again" : "See my price"}
                  </button>
                )}
                {priceError ? <p className={s.error} role="alert">{priceError}</p> : null}
                {priced && priced.for === design ? (
                  <>
                    <div className={s.grid2}>
                      <label className={s.field}>
                        <span className={s.lbl}>Your name</span>
                        <input id="client-name" className={s.in} value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} data-web-name />
                      </label>
                      <label className={s.field}>
                        <span className={s.lbl}>Phone</span>
                        <input className={s.in} value={phone} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} data-web-phone />
                      </label>
                    </div>
                    {props.website.askEmail ? (
                      <label className={s.field}>
                        <span className={s.lbl}>{props.website.house ? "Email" : "Email — for your copy of the price"}</span>
                        <input className={s.in} type="email" required={!!props.website.house} value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} data-web-email />
                      </label>
                    ) : null}
                    <label className={s.field}>
                      <span className={s.lbl}>Anything else?</span>
                      <textarea className={s.area} rows={3} maxLength={1500} value={note} placeholder="Lights, a hot tub, built-in benches, when you'd like it built…" onChange={(e) => setNote(e.target.value)} data-web-note />
                    </label>
                    <label className={s.consent}>
                      <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-web-consent />
                      <span>{props.website?.house ? LEAD_CONSENT_TEXT : `${shopName} may call, text or email me about this deck.`}</span>
                    </label>
                    <input className={s.hp} tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} aria-hidden="true" name="company" />
                    {sendError ? <p className={s.error} role="alert">{sendError}</p> : null}
                    {sent && !changedSinceSent ? (
                      <div className={s.sentBox} data-client-sent data-web-lead={sentLeadId ?? props.website.leadId ?? ""}>
                        <b>Sent ✓</b> {shopName} has your design and the price you saw, and will send the full quote{phone ? ` — ${phone}` : ""}.
                      </div>
                    ) : null}
                    <button type="button" className={s.sendBtn} onClick={() => void send()} disabled={sending} data-web-send>
                      {sending ? "Sending…" : sent ? (changedSinceSent ? "Send the changes" : "Send again") : "Get my full quote"}
                    </button>
                    <p className={s.fine}>No account, no payment. {shopName} sees your design only when you send it.</p>
                  </>
                ) : null}
              </Section>
            ) : (
            <Section n={next()} id="step-send" title={`Send it to ${shopName}`} sub="Look it over, add anything we should know, and send. You can change it and send again later.">
              <ul className={s.summary} data-client-summary>
                {pickedLines(design).map((l) => (
                  <li key={l}>{l}</li>
                ))}
                {unsureHeight ? <li>Height: please measure</li> : null}
              </ul>
              <label className={s.field}>
                <span className={s.lbl}>Anything else?</span>
                <textarea className={s.area} rows={4} maxLength={1500} value={note} placeholder="Lights, a hot tub, built-in benches, a gate, privacy screen, when you'd like it built…" onChange={(e) => setNote(e.target.value)} data-client-note />
              </label>
              <div className={s.grid2}>
                <label className={s.field}>
                  <span className={s.lbl}>Your name</span>
                  <input id="client-name" className={s.in} value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
                </label>
                <label className={s.field}>
                  <span className={s.lbl}>Phone</span>
                  <input className={s.in} value={phone} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} />
                </label>
              </div>
              {sendError ? <p className={s.error} role="alert">{sendError}</p> : null}
              {sent && !changedSinceSent ? (
                <div className={s.sentBox} data-client-sent>
                  {/* Where it stands, from the client's side (2026-10-13): sent → opened by the shop → priced → proposal → accepted. */}
                  <ol className={s.sentSteps} aria-label="Where your design stands" data-client-steps>
                    {(() => {
                      const seen = !!props.seenAt && !!sent && Date.parse(props.seenAt) >= Date.parse(sent.at) - 1000;
                      const accepted = !!props.proposal && ["ACCEPTED", "COMPLETED", "PAID"].includes(props.proposal.status);
                      const ready = !!props.proposal;
                      const priced = ready || !!props.pricedAt;
                      const steps: Array<[string, boolean]> = [["Sent", true], [`${shopName} opened it`, seen || priced], ["Priced", priced], ["Proposal ready", ready], ["Accepted", accepted]];
                      return steps.map(([label, done]) => <li key={label} className={done ? s.stepDone : s.stepTodo}>{label}</li>);
                    })()}
                  </ol>
                  {props.proposal ? (
                    <>
                      <b>{props.proposal.status === "ACCEPTED" || props.proposal.status === "COMPLETED" || props.proposal.status === "PAID" ? "Accepted ✓" : "Your proposal is ready ✓"}</b> {shopName} priced your design.{" "}
                      <a href={props.proposal.url} data-client-proposal>{props.proposal.status === "ACCEPTED" || props.proposal.status === "COMPLETED" || props.proposal.status === "PAID" ? "See your signed proposal" : "Open your proposal"}</a>
                      {props.proposal.status === "ACCEPTED" || props.proposal.status === "COMPLETED" || props.proposal.status === "PAID" ? null : " — changing the design here and sending it again asks for a new price."}
                    </>
                  ) : (
                    <>
                      <b>Sent ✓</b> {props.seenAt && sent && Date.parse(props.seenAt) >= Date.parse(sent.at) - 1000 ? `${shopName} opened it and is pricing it.` : `${shopName} has your design and will be in touch with the price.`} Change anything and send it again any time.
                    </>
                  )}
                </div>
              ) : null}
              <button type="button" className={s.sendBtn} onClick={() => void send()} disabled={sending} data-client-send>
                {sending ? "Sending…" : sent ? (changedSinceSent ? `Send the changes to ${shopName}` : "Send again") : `Send my design to ${shopName}`}
              </button>
              <p className={s.fine}>No prices on this page — {shopName} prices your design and sends it to you.</p>
            </Section>
            )}
          </div>
        </div>

        <div className={s.dock} data-client-dock>
          <span className={s.dockWhat}>{sent && !changedSinceSent ? `Sent to ${shopName} ✓` : what}</span>
          <button type="button" className={s.dockBtn} onClick={toSend}>{sent && !changedSinceSent ? "Review" : props.website ? "See my price →" : "Review & send →"}</button>
        </div>
      </div>
    </main>
  );
}
