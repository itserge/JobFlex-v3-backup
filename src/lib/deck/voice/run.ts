// CARRYING OUT WHAT WAS SAID (2026-10-21) — pure.
//
// One command (commands.ts) laid over the design through the studio's own doors (lib/deck/edit: the patch with the
// house kept in agreement and the frame settled, the roof patch, the structure switch), so whatever is said ends on a
// deck the engine can build — the numbers inside their rails, the choices the wall or the code rules out moved to the
// nearest that stands, and said so. Each command comes back with what to say, the field it changed (flashed in the
// form), the part to light or fly to in 3D, and — where the studio would not do it alone — a question to confirm.

import { DECKING, deckingProduct, treatedDecking, wallType, type DeckingProduct } from "../catalog";
import { JOIST_SIZES } from "../codeTables";
import { applyDeckPatch, type DeckPatch } from "../checks";
import {
  DECK_LIMITS,
  ELECTRICAL_LIMITS,
  FIXTURE_LABEL,
  DOUBLE_DECK_STOREY_IN,
  LOWER_LIMITS,
  PLACEMENT_LABEL,
  ROOFING_LABEL,
  ROOF_KIND_LABEL,
  ROOF_LIMITS,
  SPA_LIMITS,
  STAIR_LIMITS,
  STRUCTURE_LABEL,
  WALL_FILL_LABEL,
  defaultDeckDesign,
  defaultFixture,
  defaultStair,
  hasDeck,
  isDoubleDeck,
  shapeAreaSqFt,
  sizeWords,
  type DeckDesign,
  type DeckShape,
  type Fixture,
  type RoofDesign,
  type RoofKind,
  type StairDesign,
  type StairSide,
} from "../design";
import { patchDesign, patchRoof, switchStructure } from "../edit";
import type { FieldFocus } from "../fieldParts";
import { HOUSE_ROOF_LABEL, QUICK_WALL_LABEL, ROOF_COLOURS, SIDINGS, houseForShape, quickWall, resizeDeckLeft, shiftHouseThings, slideDeck } from "../house";
import type { DeckPriceOptions } from "../pricing";
import { railMountLine } from "../rails";
import { railMountFor, type RailSectionKey } from "../design";
import { DECK_SAMPLES } from "../samples";
import { autoFixDesign, settleDesign } from "../settle";
import { deckLoadForSnow } from "../site";
import { buildStructure } from "../structure";
import { COLORS, FIXTURE_SAY, type Amount, type DeckCommand, type DeckingSet, type Look, type RoofSet } from "./commands";
import { firstSentence, ftWords, halfFt, inWords } from "./words";

export interface RunEnv extends DeckPriceOptions {
  /** The shop's state, for a job with no address yet (the regional boards). */
  homeState?: string | null;
  /** The structure was switched earlier in the same sentence ("a covered porch with a gable roof"): its roof is new. */
  freshRoof?: boolean;
}

/** The roof shapes a covered deck does not carry — they stand on posts all around, as a gazebo (over the deck or not). */
const GAZEBO_ONLY = new Set<RoofKind>(["pyramid", "double-tier", "gambrel", "dutch-gable"]);
const kindWord = (k: RoofKind) => ROOF_KIND_LABEL[k].split(" — ")[0].toLowerCase().replace(/^dutch/, "Dutch");

/** A structure switched from one roofed kind to another keeps what was chosen for the roof: its roofing, ceiling, gutters, trim, height, pitch, posts and walls. */
function carryRoof(next: DeckDesign, old: RoofDesign | null, fromStructure: string): DeckDesign {
  if (!old || fromStructure === "deck" || next.structure === "deck") return next;
  const keep: Partial<RoofDesign> = { eaveHeightIn: old.eaveHeightIn, overhangIn: old.overhangIn, post: old.post, braces: old.braces, extras: old.extras };
  if (next.structure !== "pergola" && fromStructure !== "pergola") Object.assign(keep, { roofing: old.roofing, ceiling: old.ceiling, gutters: old.gutters, fascia: old.fascia, soffit: old.soffit, cupola: old.cupola, pitch: old.pitch, walls: old.walls });
  return applyDeckPatch(next, { roof: { ...next.roof, ...keep } });
}

export type ViewChange = Partial<{ tab: "3d" | "plan" | "wall"; xray: boolean; night: boolean; connections: boolean; build: "play" | "stop" | "done"; full: boolean; reset: boolean; look: Look; edit: boolean }>;
export type GoStep = "kind" | "size" | "house" | "materials" | "stairs" | "roof" | "extras" | "checks" | "package";

/** A field of the form to flash where it was changed, inside its section when the label is not unique. */
export interface Flash {
  label: string;
  section?: GoStep;
}

/** A question back: what "yes" does, or what a number said next fills in. */
export interface Pending {
  ask: string;
  yes: DeckCommand[];
  /** A price said next prices this item (the studio could not draw it, so it is the shop's own). */
  price?: { item: string };
}

export interface Meta {
  open?: "permit" | "yard" | "installer";
  go?: GoStep;
  name?: string;
  address?: string;
  save?: boolean;
  reset?: boolean;
  stop?: boolean;
  mute?: boolean;
  help?: boolean;
  undo?: boolean;
  redo?: boolean;
  teach?: { phrase: string; words: string };
  forget?: { phrase?: string };
  wish?: { text: string; item?: string };
  remember?: { name: string; unit: "ea" | "pcs" | "ft" | "sq ft" | "bags"; price: number };
}

export interface Outcome {
  design: DeckDesign;
  said: string[];
  light?: FieldFocus | null;
  fly?: [number, number, number] | null;
  flash?: Flash[];
  /** The studio's "chosen by hand" keys: a new address no longer overwrites these. */
  touched?: string[];
  view?: ViewChange;
  pending?: Pending | null;
  meta?: Meta;
  /** Could not be done; the words say why. */
  refused?: boolean;
  /** What settling the frame to the tables changed, in the checks' own words. */
  settled?: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const amt = (cur: number, a: Amount | undefined): number => (!a ? cur : "to" in a ? a.to : "by" in a ? cur + a.by : cur * a.times);
const toInch = (ft: number) => Math.round(ft * 12) / 12;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The settle the studio runs on a resize — its fixes kept so they can be said. */
function settler(env: RunEnv, notes: string[]): (d: DeckDesign) => DeckDesign {
  return (d) => {
    const s = settleDesign(d, { rates: env.rates, market: env.market });
    for (const f of s.fixes) if (!notes.includes(f)) notes.push(f);
    return s.design;
  };
}

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/* ------------------------------------------------------------------ */

function lab(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const x = (ch[0] * 0.4124 + ch[1] * 0.3576 + ch[2] * 0.1805) / 0.95047;
  const y = ch[0] * 0.2126 + ch[1] * 0.7152 + ch[2] * 0.0722;
  const z = (ch[0] * 0.0193 + ch[1] * 0.1192 + ch[2] * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: string, b: string) => {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};
const MANUFACTURED = new Set(["composite", "pvc", "mineral"]);
const WOOD = new Set(["treated", "softwood", "hardwood", "modified"]);
/** A board's family as said in a sentence. */
const FAMILY_NOUN: Record<string, string> = { treated: "treated", softwood: "softwood", hardwood: "hardwood", modified: "modified-wood", composite: "capped composite", pvc: "PVC", mineral: "mineral-based", aluminum: "aluminum" };

/** The board closest to a colour: in the line or the family now laid where one is close, else across the boards that come in it. */
export function boardForColor(current: DeckingProduct, colorId: string): { product: DeckingProduct; switchedFamily: boolean } | null {
  const ref = COLORS.find((c) => c.id === colorId);
  if (!ref) return null;
  const greyish = /gray|black/.test(colorId);
  // The same line first, then the family, then the boards that come in that colour — each only when the colour is
  // really there (a brown is not taken for the gray that was asked for).
  const pools: Array<[DeckingProduct[], number]> = [];
  if (current.brand) pools.push([DECKING.filter((p) => p.brand === current.brand), 8]);
  pools.push([DECKING.filter((p) => p.family === current.family), 9]);
  // Wood is not sold gray or black: those colours are the capped boards'.
  pools.push([DECKING.filter((p) => (MANUFACTURED.has(current.family) || greyish ? MANUFACTURED.has(p.family) : WOOD.has(p.family))), MANUFACTURED.has(current.family) ? 22 : 12]);
  // A capped deck stays capped for a colour (no jump to a tropical hardwood for "red"); wood may go anywhere.
  if (!MANUFACTURED.has(current.family)) pools.push([[...DECKING], 16]);
  for (const [pool, near] of pools) {
    const best = pool.map((p) => ({ p, e: deltaE(p.color, ref.hex) })).sort((a, b) => a.e - b.e)[0];
    if (best && best.e <= near) return { product: best.p, switchedFamily: best.p.family !== current.family };
  }
  const any = DECKING.map((p) => ({ p, e: deltaE(p.color, ref.hex) })).sort((a, b) => a.e - b.e)[0];
  return any ? { product: any.p, switchedFamily: any.p.family !== current.family } : null;
}

/**
 * One shade lighter or darker: in the same line where it has one, else the makers' own boards of the same kind, else the
 * family — the nearest step in lightness that keeps the colour's tone (a reddish brown goes to a darker brown, not a gray).
 */
export function boardShade(current: DeckingProduct, shade: "lighter" | "darker"): DeckingProduct | null {
  const [L, a, b] = lab(current.color);
  const others = DECKING.filter((p) => p.id !== current.id);
  const pools = [
    current.brand ? others.filter((p) => p.brand === current.brand) : [],
    current.brand ? others.filter((p) => !!p.brand && p.family === current.family) : [],
    current.brand ? others.filter((p) => !!p.brand && MANUFACTURED.has(p.family) && MANUFACTURED.has(current.family)) : [],
    others.filter((p) => p.family === current.family),
  ];
  for (const list of pools) {
    const cands = list
      .map((p) => {
        const q = lab(p.color);
        return { p, d: q[0] - L, tone: Math.hypot(q[1] - a, q[2] - b) };
      })
      .filter((x) => (shade === "lighter" ? x.d > 3 : x.d < -3))
      .sort((x, y) => Math.abs(x.d) + 0.6 * x.tone - (Math.abs(y.d) + 0.6 * y.tone));
    if (cands[0]) return cands[0].p;
  }
  return null;
}

/** The reference colour a board reads as ("dark gray", "brown"). */
export function colorName(hex: string): string {
  return COLORS.map((c) => ({ c, e: deltaE(hex, c.hex) })).sort((a, b) => a.e - b.e)[0]?.c.id ?? "brown";
}

/** "Fiberon Concordia (dark gray)", "Ipe 1x6": the capped boards with the colour they read as; wood by its name. */
export function boardWords(p: DeckingProduct): string {
  if (!MANUFACTURED.has(p.family) && p.family !== "aluminum") return p.label;
  return /\)$/.test(p.label) ? `${p.label.slice(0, -1)}, ${colorName(p.color)})` : `${p.label} (${colorName(p.color)})`;
}

/* ------------------------------------------------------------------ */
/*  Stairs                                                             */
/* ------------------------------------------------------------------ */

function nextStairId(list: readonly StairDesign[]): string {
  for (let k = list.length + 1; ; k++) {
    const id = `s${k}v`;
    if (!list.some((s) => s.id === id)) return id;
  }
}
const sideLength = (d: DeckDesign, side: StairSide, level: "upper" | "lower") => (level === "lower" ? (side === "front" ? d.lower.widthFt : d.lower.depthFt) : side === "front" ? d.shape.widthFt : d.shape.depthFt);

function stairAt(d: DeckDesign, st: StairDesign, at: Extract<DeckCommand, { do: "stairs" }>["at"]): number {
  const L = sideLength(d, st.side, st.level);
  const w = st.widthFt;
  if (at === undefined) return st.atFt;
  if (at === "center") return L / 2;
  if (at === "left" || at === "house") return w / 2;
  if (at === "right" || at === "out") return Math.max(w / 2, L - w / 2);
  if ("ft" in at) return at.ft + w / 2;
  return st.atFt + at.by;
}

/** Where a stair stands in the scene's feet (its footprint's middle), to fly to. */
function stairPoint(d: DeckDesign, id: string): [number, number, number] | null {
  try {
    const s = buildStructure(d);
    const b = s.stairs.find((x) => x.design.id === id);
    if (!b || !b.footprint.length) return null;
    const x = b.footprint.reduce((a, p) => a + p.x, 0) / b.footprint.length / 12;
    const y = b.footprint.reduce((a, p) => a + p.y, 0) / b.footprint.length / 12;
    return [x, y, Math.max(0.5, b.riseIn / 24)];
  } catch {
    return null;
  }
}

function stairWords(d: DeckDesign, id: string): string {
  try {
    const b = buildStructure(d).stairs.find((x) => x.design.id === id);
    if (!b) return "";
    if (b.kind === "box") return `${plural(b.risers, "box step")}, ${inWords(b.riserIn)} each`;
    const lands = b.lands === "lower-deck" ? "onto the lower level" : b.design.landing === "pad" ? "onto a concrete pad" : b.design.landing === "patio" ? "onto the patio" : "onto pavers";
    return `${plural(b.risers, "riser")} of ${inWords(Math.round(b.riserIn * 8) / 8)}, ${plural(b.treads, "tread")}, ${lands}`;
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/*  The runner                                                         */
/* ------------------------------------------------------------------ */

const SIDE_SAY: Record<StairSide, string> = { front: "down the front", left: "on the left side", right: "on the right side" };

export function runCommand(d0: DeckDesign, cmd: DeckCommand, env: RunEnv = {}): Outcome {
  const notes: string[] = [];
  const settle = settler(env, notes);
  const out = (design: DeckDesign, said: string[], extra: Omit<Outcome, "design" | "said"> = {}): Outcome => ({ design, said, settled: notes.length ? notes : undefined, ...extra });
  const no = (why: string, extra: Omit<Outcome, "design" | "said"> = {}): Outcome => ({ design: d0, said: [why], refused: true, ...extra });
  const d = d0;
  switch (cmd.do) {
    /* ── size ── */
    case "size": {
      if (!hasDeck(d)) {
        // A gazebo or a pergola on a slab or the ground: its own outline is the size.
        const pl = d.roof.plan;
        const polygon = pl.shape === "hexagon" || pl.shape === "octagon" || pl.shape === "round";
        if (polygon) {
          const across = clamp(halfFt(amt(pl.acrossFt, cmd.width ?? cmd.depth)), ROOF_LIMITS.acrossFt.min, ROOF_LIMITS.acrossFt.max);
          const next = patchRoof(d, { plan: { ...pl, acrossFt: across } }, settle);
          return out(next, [`${ftWords(across)} across the flats.`], { flash: [{ label: "Across the flats" }], light: { label: "Across the flats", step: "step-footprint" } });
        }
        let w = amt(pl.widthFt, cmd.width);
        let dp = pl.shape === "square" ? w : amt(pl.depthFt, cmd.depth);
        if (cmd.areaSqFt) {
          const r = w / dp;
          w = Math.sqrt(cmd.areaSqFt * r);
          dp = cmd.areaSqFt / w;
        }
        w = clamp(halfFt(w), ROOF_LIMITS.planFt.min, ROOF_LIMITS.planFt.max);
        dp = clamp(halfFt(dp), ROOF_LIMITS.planFt.min, ROOF_LIMITS.planFt.max);
        const next = patchRoof(d, { plan: { ...pl, widthFt: w, depthFt: pl.shape === "square" ? w : dp } }, settle);
        return out(next, [`${ftWords(w)} × ${ftWords(pl.shape === "square" ? w : dp)}.`], { flash: [{ label: "Along the house" }, { label: "Out from the house" }], light: { label: "Along the house", step: "step-footprint" } });
      }
      const s = d.shape;
      // "All the way across the house": the deck as wide as the wall, its ends at the house's corners.
      if (cmd.from === "house") {
        const full = toInch(clamp(s.widthFt + d.house.leftFt + d.house.rightFt, DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max));
        const next = patchDesign(d, { shape: { ...s, widthFt: full } as DeckShape, house: { ...d.house, leftFt: 0, rightFt: 0, jogs: d.house.jogs.map((j) => ({ ...j, atFt: j.atFt + d.house.leftFt })), ...shiftHouseThings(d.house, d.house.leftFt) } }, settle);
        return out(next, [`All the way across the house — ${ftWords(next.shape.widthFt)} along the wall.${s.widthFt + d.house.leftFt + d.house.rightFt > DECK_LIMITS.widthFt.max ? ` (The studio goes up to ${DECK_LIMITS.widthFt.max} ft.)` : ""}`], { flash: [{ label: "Along the house" }], light: { label: "Along the house", step: "step-shape" }, view: { reset: true } });
      }
      let w = amt(s.widthFt, cmd.width);
      let dp = amt(s.depthFt, cmd.depth);
      if (cmd.areaSqFt) {
        const r = s.widthFt / s.depthFt;
        w = Math.sqrt(cmd.areaSqFt * r);
        dp = cmd.areaSqFt / w;
        w = halfFt(w);
        dp = halfFt(dp);
      }
      if (cmd.square) dp = w;
      const rel = (a: Amount | undefined) => !!a && !("to" in a);
      if (rel(cmd.width)) w = halfFt(w);
      if (rel(cmd.depth)) dp = halfFt(dp);
      const asked = { w, dp };
      w = toInch(clamp(w, DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max));
      dp = toInch(clamp(dp, DECK_LIMITS.depthFt.min, DECK_LIMITS.depthFt.max));
      const said: string[] = [];
      if (asked.w > DECK_LIMITS.widthFt.max + 0.01) said.push(`The studio goes up to ${DECK_LIMITS.widthFt.max} ft along the house, so it's ${DECK_LIMITS.widthFt.max}.`);
      if (asked.dp > DECK_LIMITS.depthFt.max + 0.01) said.push(`It reaches out ${DECK_LIMITS.depthFt.max} ft at most, so it's ${DECK_LIMITS.depthFt.max}.`);
      if (asked.w < DECK_LIMITS.widthFt.min - 0.01 || asked.dp < DECK_LIMITS.depthFt.min - 0.01) said.push(`A deck is at least ${DECK_LIMITS.widthFt.min} ft each way.`);
      let next: DeckDesign;
      if (cmd.from === "left" && w !== s.widthFt) {
        const moved = resizeDeckLeft(d.house, s, w, DECK_LIMITS.widthFt.min, DECK_LIMITS.widthFt.max);
        next = patchDesign(d, { shape: { ...moved.shape, depthFt: dp } as DeckShape, house: moved.house }, settle);
      } else next = patchDesign(d, { shape: { ...s, widthFt: w, depthFt: dp } as DeckShape }, settle);
      const area = Math.round(shapeAreaSqFt(next.shape));
      said.unshift(`${sizeWords(next)} — ${area} sq ft.`);
      const widthChanged = next.shape.widthFt !== s.widthFt;
      return out(next, said, { flash: [{ label: "Along the house" }, { label: "Out from the house" }], light: { label: widthChanged ? "Along the house" : "Out from the house", step: "step-shape" } });
    }
    case "height": {
      if (!hasDeck(d)) return no(`It stands ${d.floor === "slab" ? "on a slab" : "on footings in the ground"} — there's no deck floor to raise. The roof's height is the headers: say "9-foot ceiling".`);
      const asked = amt(d.heightIn, cmd.in);
      const h = Math.round(clamp(asked, DECK_LIMITS.heightIn.min, DECK_LIMITS.heightIn.max) * 4) / 4;
      const next = patchDesign(d, { heightIn: h }, settle);
      const said = [`Deck height ${inWords(h)}${h >= 24 ? ` (${h} in.)` : ""} above the ground.`];
      if (asked > DECK_LIMITS.heightIn.max) said.push(`That's the highest the studio frames: ${inWords(DECK_LIMITS.heightIn.max)}.`);
      return out(next, said, { flash: [{ label: "Deck height" }], light: { label: "Deck height" } });
    }
    case "shape": {
      if (!hasDeck(d)) return no("The outline here is the roof's — say \"make it an octagon\" or \"a 12-foot square\".");
      const s = d.shape;
      const base = { widthFt: s.widthFt, depthFt: s.depthFt };
      let shape: DeckShape;
      let words: string;
      if (cmd.kind === "L") {
        const corner = cmd.corner ?? "front-right";
        shape = { kind: "L", ...base, notch: { corner, widthFt: cmd.notchWidthFt ?? (s.kind === "L" ? s.notch.widthFt : halfFt(s.widthFt / 3)), depthFt: cmd.notchDepthFt ?? (s.kind === "L" ? s.notch.depthFt : halfFt(s.depthFt / 2)) } };
        words = `L-shaped — the ${corner.replace("-", " ")} corner cut away`;
      } else if (cmd.kind === "curve") {
        shape = { kind: "rect", ...base, front: { kind: "curve", bulgeFt: cmd.bulgeFt ?? 2, clipFt: 2 } };
        words = "a curved front";
      } else if (cmd.kind === "clipped") {
        shape = { kind: "rect", ...base, front: { kind: "clipped", bulgeFt: 2, clipFt: cmd.clipFt ?? 2 } };
        words = "the front corners clipped at 45°";
      } else {
        shape = { kind: "rect", ...base };
        words = "a plain rectangle";
      }
      const next = patchDesign(d, { shape }, settle);
      const got = next.shape;
      const said = [`Made it ${words}.`];
      if (cmd.kind === "L" && got.kind === "L") said[0] = `Made it L-shaped — a ${ftWords(got.notch.widthFt)} × ${ftWords(got.notch.depthFt)} notch at the ${got.notch.corner.replace("-", " ")}.`;
      else if (cmd.kind === "L" && got.kind !== "L") return no("It's too small to cut a corner out and keep both legs at least 3 ft — make it bigger first.");
      if (cmd.kind === "curve" && got.kind === "rect" && got.front?.kind === "curve") said[0] = `A curved front, bowed out ${ftWords(got.front.bulgeFt)} at the middle.`;
      if (cmd.kind === "clipped" && got.kind === "rect" && got.front?.kind === "clipped") said[0] = `The front corners clipped ${ftWords(got.front.clipFt)} at 45°.`;
      const label = cmd.kind === "L" ? "Corner cut away" : "The front edge";
      return out(next, said, { flash: [{ label }], light: { label, step: "step-shape" } });
    }
    case "slide": {
      const h = d.house;
      const delta = cmd.ft === "center" ? (h.rightFt - h.leftFt) / 2 : cmd.ft;
      const house = slideDeck(h, delta);
      if (house === h) return no("It can't slide farther that way — the house ends there.");
      const next = patchDesign(d, { house }, settle);
      const moved = Math.abs(house.leftFt - h.leftFt);
      return out(next, [cmd.ft === "center" ? "Centered the deck on the house wall." : `Slid the deck ${ftWords(moved)} to the ${delta < 0 ? "left" : "right"} along the house.`], { view: { reset: true } });
    }
    case "placement": {
      if (!hasDeck(d)) return no("There's no deck under it to attach — the roof itself can hang on the house: say \"attach the roof to the house\".");
      const next = patchDesign(d, { placement: cmd.to }, settle);
      if (cmd.to === "attached" && next.placement !== "attached") return out(next, [`It can't be bolted to this wall (${lower(wallType(next.wall).label)}). ${wallType(next.wall).why}`], { flash: [{ label: "How it meets the house" }], light: { label: "How it meets the house" } });
      return out(next, [`${PLACEMENT_LABEL[next.placement]}.`], { flash: [{ label: "How it meets the house" }], light: { label: "How it meets the house" } });
    }
    case "wall": {
      const before = d.placement;
      const next = patchDesign(d, { wall: cmd.to }, settle);
      const w = wallType(next.wall);
      const said = [`The house wall: ${lower(w.label)}.`];
      if (before === "attached" && next.placement !== "attached") said.push(`${w.why}`);
      return out(next, said, { flash: [{ label: "The house wall there" }], light: { label: "The house wall there" } });
    }
    case "structure": {
      if (cmd.to === d.structure) return out(d, [`It's already ${STRUCTURE_LABEL[d.structure].toLowerCase() === "deck" ? "a plain deck" : `a ${STRUCTURE_LABEL[d.structure].toLowerCase()}`}.`]);
      const next = carryRoof(switchStructure(d, cmd.to), d.roof, d.structure);
      const r = next.roof;
      const words = cmd.to === "deck" ? "A plain deck — the roof is off (its settings are kept if you put it back)." : cmd.to === "pergola" ? `A pergola: ${r.slats.size} slats ${r.slats.spacingIn} in. apart over the headers.` : `A ${STRUCTURE_LABEL[cmd.to].toLowerCase()} with a ${ROOF_KIND_LABEL[r.kind].split(" — ")[0].toLowerCase()} roof at ${r.pitch}/12, ${lower(ROOFING_LABEL[r.roofing])}.`;
      return out(next, [words], { view: { reset: true, tab: "3d" }, light: cmd.to === "deck" ? null : { label: "Roofing", step: "step-roof" } });
    }
    case "floor": {
      if (d.structure !== "gazebo" && d.structure !== "pergola") return no("A deck and a covered deck always stand on the deck. A gazebo or a pergola can stand on a slab or the ground.");
      const next = patchDesign(d, { floor: cmd.to }, settle);
      return out(next, [cmd.to === "slab" ? "On a new concrete slab — it goes in the price." : cmd.to === "existing" ? "On the existing slab — no concrete in the price; the posts sit on anchored bases." : cmd.to === "ground" ? "On footings in the ground." : "On a deck."], { flash: [{ label: "It stands" }], light: { label: "It stands" }, view: { reset: true } });
    }
    case "roof":
      return runRoof(d, cmd.set, env, settle, out, no);
    case "decking":
      return runDecking(d, cmd.set, env, settle, out, no);
    case "framing": {
      if (!hasDeck(d)) return no("There's no deck frame under this one — it stands on a slab or the ground.");
      const f = cmd.set;
      const p: DeckPatch["framing"] = {};
      const said: string[] = [];
      const flash: Flash[] = [];
      let light: FieldFocus | null = null;
      const nowJoist = buildStructure(d).frame?.joistSize ?? "2x8";
      if (f.joist) {
        const i = JOIST_SIZES.indexOf(nowJoist);
        p.joist = f.joist === "up" ? JOIST_SIZES[Math.min(JOIST_SIZES.length - 1, i + 1)] : f.joist === "down" ? JOIST_SIZES[Math.max(0, i - 1)] : f.joist;
        flash.push({ label: "Joists" });
        light = { label: "Joists" };
      }
      if (f.spacingIn) {
        p.spacingIn = f.spacingIn;
        flash.push({ label: "Joist spacing" });
        light = { label: "Joist spacing" };
      }
      if (f.beamKind) p.beamKind = f.beamKind;
      if (f.beam) p.beam = f.beam;
      if (f.beamStyle) p.beamStyle = f.beamStyle;
      if (f.beam || f.beamKind || f.beamStyle) {
        flash.push({ label: "Beams" }, { label: "Beam size" });
        light = { label: "Beams", step: "Frame" };
      }
      if (f.post) {
        p.post = f.post;
        flash.push({ label: "Posts", section: "materials" });
        light = { label: "Posts", step: "Frame" };
      }
      if (f.overhangFt !== undefined) {
        p.overhangFt = f.overhangFt === "auto" ? "auto" : clamp(f.overhangFt, DECK_LIMITS.overhangFt.min, DECK_LIMITS.overhangFt.max);
        flash.push({ label: "Joists past the beam" });
        light = { label: "Joists past the beam" };
      }
      if (f.species) {
        p.species = f.species;
        // OC composite framing (2026-11-12): the maker's own way — doubled band joists, built-up beams, the OC post.
        if (f.species === "oc-lumber") Object.assign(p, { doubleRim: true, beam: "auto", joistTape: false });
        else if (d.framing.species === "oc-lumber") Object.assign(p, { post: "6x6", beam: "auto" });
        flash.push({ label: "Framing lumber" });
        light = { label: "Framing lumber" };
      }
      if (f.doubleRim !== undefined) p.doubleRim = f.doubleRim;
      if (f.joistTape !== undefined) p.joistTape = f.joistTape;
      if (f.blocking) p.blocking = f.blocking;
      if (f.braces !== undefined) p.braces = f.braces;
      const next = patchDesign(d, { framing: p }, settle);
      const s = buildStructure(next);
      const fr = s.frame;
      if (fr) {
        if (f.joist || f.spacingIn) {
          said.push(`Joists: ${fr.joistSize} at ${fr.spacingIn} in. on center — ${plural(fr.joists.filter((j) => !j.sister).length, "joist")}.`);
          if (p.joist && p.joist !== "auto" && fr.joistSize !== p.joist) said.push(`${p.joist} won't span it at that spacing, so the tables kept ${fr.joistSize}.`);
        }
        if (f.beam || f.beamKind || f.beamStyle) said.push(`Beams: ${[...new Set(fr.beams.map((b) => b.spec.size))].join(", ")}, ${fr.beamStyle}.${fr.beamKindNote ? ` ${fr.beamKindNote}` : ""}`);
        if (f.post) said.push(`${next.framing.post} posts — ${plural(fr.posts.length, "post")}.`);
        if (f.overhangFt !== undefined) said.push(next.framing.overhangFt === "auto" ? "The joists run past the beam as far as the table allows." : `The joists run ${ftWords(Number(next.framing.overhangFt))} past the beam.`);
      }
      if (f.species) said.push(`Framing lumber: ${lower(fr?.species.label ?? f.species)}.`);
      if (f.doubleRim !== undefined) said.push(f.doubleRim ? "Doubled rim and outside joists." : "A single rim.");
      if (f.joistTape !== undefined) said.push(f.joistTape ? "Joist tape on every joist." : "No joist tape.");
      if (f.blocking) said.push(f.blocking === "mid-span" ? "Mid-span blocking between the joists." : "Blocking where the beams and the boards ask for it.");
      if (f.braces !== undefined) said.push(f.braces ? "Knee braces at the corner posts." : "No knee braces.");
      return out(next, said.length ? said : ["Done."], { flash, light, touched: f.species ? ["species"] : [], view: light ? { xray: true } : undefined });
    }
    case "ledger": {
      if (d.placement !== "attached") return no("It isn't on a ledger — it stands on its own posts. Say \"attach it to the house\" first.");
      const next = patchDesign(d, { ledger: { ...(cmd.fastener ? { fastener: cmd.fastener } : {}), ...(cmd.lateral ? { lateral: cmd.lateral } : {}) } }, settle);
      const said: string[] = [];
      if (cmd.fastener) said.push(next.ledger.fastener === cmd.fastener ? `Ledger fastened with ${cmd.fastener === "lag" ? "lag screws" : cmd.fastener === "bolt" ? "through-bolts" : cmd.fastener === "bolt-gap" ? "through-bolts" : cmd.fastener === "ledgerlok" ? "LedgerLOK screws" : cmd.fastener === "sdws" ? "Simpson SDWS screws" : "anchors"}.` : `That fastener has no table for this wall — it stays ${next.ledger.fastener}.`);
      if (cmd.lateral) said.push(cmd.lateral === "four" ? "Four 750-lb hold-downs to the house." : "Two 1,500-lb hold-downs to the house.");
      return out(next, said, { flash: [{ label: "Ledger fastened with" }], light: { label: "Ledger fastened with" } });
    }
    case "footing": {
      const p: DeckPatch["footing"] = {};
      if (cmd.type) p.type = cmd.type;
      if (cmd.aboveGradeIn !== undefined) p.aboveGradeIn = clamp(cmd.aboveGradeIn, DECK_LIMITS.aboveGradeIn.min, DECK_LIMITS.aboveGradeIn.max);
      if (cmd.frostAlways !== undefined) p.frostAlways = cmd.frostAlways;
      const next = patchDesign(d, { footing: p }, settle);
      const said: string[] = [];
      if (cmd.type) said.push(cmd.type === "pier-block" ? "Precast pier blocks on the ground — only for a low deck that isn't attached; the checks say where the code allows them." : "Poured concrete footings.");
      if (cmd.frostAlways !== undefined) said.push(cmd.frostAlways ? `Every footing dug below the frost line, ${next.frostIn} in.` : "Free-standing footings dug to the code's minimum.");
      if (cmd.aboveGradeIn !== undefined) said.push(`Footing tops ${next.footing.aboveGradeIn} in. above grade.`);
      return out(next, said, { flash: [{ label: "Footings" }], light: { label: "Footings" }, view: { xray: true } });
    }
    case "site": {
      const p: DeckPatch = {};
      const said: string[] = [];
      const touched: string[] = [];
      const flash: Flash[] = [];
      let light: FieldFocus | null = null;
      if (cmd.frostIn) {
        p.frostIn = Math.round(clamp(amt(d.frostIn, cmd.frostIn), DECK_LIMITS.frostIn.min, DECK_LIMITS.frostIn.max));
        touched.push("frost");
        said.push(`Frost line ${p.frostIn} in. — the footings go below it.`);
        flash.push({ label: "Frost depth" });
        light = { label: "Frost depth" };
      }
      if (cmd.snowPsf !== undefined) {
        const snow = Math.round(clamp(cmd.snowPsf, DECK_LIMITS.groundSnowPsf.min, DECK_LIMITS.groundSnowPsf.max));
        const load = deckLoadForSnow(snow);
        p.site = { ...d.site, ...(p.site ?? {}), groundSnowPsf: snow };
        p.loadPsf = load.load;
        touched.push("load");
        said.push(`Ground snow ${snow} psf — the deck is designed for ${load.load} psf${load.beyond ? ", the most the tables cover: an engineer should look at it" : ""}.`);
        flash.push({ label: "Design load" });
        light = { label: "Design load" };
      }
      if (cmd.loadPsf) {
        p.loadPsf = cmd.loadPsf;
        touched.push("load");
        said.push(`Designed for ${cmd.loadPsf} psf.`);
        flash.push({ label: "Design load" });
        light = { label: "Design load" };
      }
      if (cmd.soilPsf) {
        p.soilPsf = cmd.soilPsf;
        said.push(`Soil bearing ${cmd.soilPsf.toLocaleString("en-US")} psf — the footings are sized to it.`);
        flash.push({ label: "Soil bears" });
        light = { label: "Soil bears" };
      }
      if (cmd.outDropIn !== undefined || cmd.acrossDropIn !== undefined) {
        const slope = { ...d.site.slope, ...(cmd.outDropIn !== undefined ? { outDropIn: cmd.outDropIn } : {}), ...(cmd.acrossDropIn !== undefined ? { acrossDropIn: cmd.acrossDropIn } : {}) };
        p.site = { ...d.site, ...(p.site ?? {}), slope };
        said.push(slope.outDropIn === 0 && slope.acrossDropIn === 0 ? "Level ground." : `The ground falls ${slope.outDropIn ? `${inWords(Math.abs(slope.outDropIn))} ${slope.outDropIn > 0 ? "away from" : "toward"} the house` : ""}${slope.outDropIn && slope.acrossDropIn ? " and " : ""}${slope.acrossDropIn ? `${inWords(Math.abs(slope.acrossDropIn))} ${slope.acrossDropIn > 0 ? "left to right" : "right to left"}` : ""} — the posts are cut to it.`);
        flash.push({ label: "Falls away from the house" });
        light = { label: "Falls away from the house" };
      }
      if (cmd.state) {
        p.site = { ...d.site, ...(p.site ?? {}), state: cmd.state };
        said.push(`Checked against ${cmd.state}'s code — set the job's address to get the county too.`);
      }
      const next = patchDesign(d, p, settle);
      return out(next, said, { touched, flash, light });
    }
    case "rail":
      return runRail(d, cmd.set, settle, out, no);
    case "stairs":
      return runStairs(d, cmd, settle, out, no);
    case "lower": {
      if (!hasDeck(d)) return no("There's no deck to step down from.");
      if (cmd.on === false) {
        if (!d.lower.on) return out(d, ["There's no lower level."]);
        const next = patchDesign(d, { lower: { on: false } }, settle);
        return out(next, ["Took the lower level off — one level now."], { view: { reset: true } });
      }
      const L = d.lower;
      // A DOUBLE DECK (2026-11-13): a deck of the same size under this one. The upper deck is raised, where it must be,
      // to leave a storey between the two.
      if (cmd.place === "under" || (L.on && L.place === "under" && cmd.place !== "front" && (cmd.heightIn || cmd.on))) {
        const lowerH = Math.round(clamp(cmd.heightIn ? amt(L.heightIn, cmd.heightIn) : L.heightIn, LOWER_LIMITS.heightIn.min, LOWER_LIMITS.heightIn.max));
        const upperH = Math.max(d.heightIn, lowerH + DOUBLE_DECK_STOREY_IN);
        const next = patchDesign(d, { heightIn: upperH, lower: { on: true, place: "under", heightIn: lowerH } }, settle);
        if (!isDoubleDeck(next)) return no("This deck can't take a second deck under it — it needs a storey between the two.");
        return out(next, [`A double deck: a second deck of the same size under this one, ${inWords(lowerH)} above the ground${next.heightIn !== d.heightIn ? `. The upper deck is raised to ${inWords(next.heightIn)} to leave a storey between them` : ""}. Its beams are let into the same posts, and the posts and footings are sized for both decks.`], { view: { reset: true } });
      }
      const p: DeckPatch["lower"] = { on: cmd.on ?? L.on, ...(cmd.place === "front" || L.place === "under" ? { place: "front" as const } : {}) };
      if (cmd.width) p.widthFt = toInch(clamp(amt(L.widthFt, cmd.width), LOWER_LIMITS.widthFt.min, LOWER_LIMITS.widthFt.max));
      if (cmd.depth) p.depthFt = toInch(clamp(amt(L.depthFt, cmd.depth), LOWER_LIMITS.depthFt.min, LOWER_LIMITS.depthFt.max));
      if (cmd.dropIn) p.dropIn = Math.round(clamp(amt(L.dropIn, cmd.dropIn), LOWER_LIMITS.dropIn.min, LOWER_LIMITS.dropIn.max) * 4) / 4;
      // "the lower level 2 ft off the ground" — a level in front: that is its drop from the deck.
      else if (cmd.heightIn) p.dropIn = Math.round(clamp(d.heightIn - amt(d.heightIn - L.dropIn, cmd.heightIn), LOWER_LIMITS.dropIn.min, LOWER_LIMITS.dropIn.max) * 4) / 4;
      if (cmd.align) p.align = cmd.align;
      const next = patchDesign(d, { lower: p }, settle);
      if (!next.lower.on) return no(d.shape.kind === "L" ? "An L-shaped deck can't take a lower level here — make it a rectangle first." : d.heightIn <= LOWER_LIMITS.dropIn.min + 4 ? `At ${inWords(d.heightIn)} it's too low for a step down — raise the deck first.` : "A curved front can't take a lower level — straighten it first.");
      const nl = next.lower;
      return out(next, [`A lower level, ${ftWords(nl.widthFt)} × ${ftWords(nl.depthFt)}, ${inWords(nl.dropIn)} down, ${nl.align === "centre" ? "centered" : `at the ${nl.align}`}.`], { flash: [{ label: "Where the lower level sits" }], light: { label: "Along the house", level: "lower" } });
    }
    case "spa": {
      if (!hasDeck(d)) return no("A hot tub sits on a deck — this one stands on a slab or the ground.");
      if (cmd.on === false) {
        if (!d.spa.on) return out(d, ["There's no hot-tub spot."]);
        return out(patchDesign(d, { spa: { on: false } }, settle), ["Took the hot-tub spot off."]);
      }
      const S = d.spa;
      const p: DeckPatch["spa"] = { on: cmd.on ?? S.on };
      if (cmd.width) p.widthFt = toInch(clamp(amt(S.widthFt, cmd.width), SPA_LIMITS.widthFt.min, SPA_LIMITS.widthFt.max));
      if (cmd.depth) p.depthFt = toInch(clamp(amt(S.depthFt, cmd.depth), SPA_LIMITS.depthFt.min, SPA_LIMITS.depthFt.max));
      if (cmd.align) p.align = cmd.align;
      const next = patchDesign(d, { spa: p, framing: {} }, settle);
      if (!next.spa.on) return no(d.shape.kind === "L" ? "The hot-tub spot needs a rectangle of deck — an L-shaped one can't take it yet." : `The deck needs to be at least ${SPA_LIMITS.widthFt.min + 1} ft each way for a tub.`);
      const ns = next.spa;
      return out(next, [`A hot-tub spot, ${ftWords(ns.widthFt)} × ${ftWords(ns.depthFt)}, at the ${ns.align === "centre" ? "middle" : ns.align} of the front — the joists under it doubled for the water's weight. The tub itself is by others.`], { flash: [{ label: "Where the tub stands" }], light: { label: "Where the tub stands" } });
    }
    case "fixture":
      return runFixture(d, cmd, settle, out, no);
    case "electrical": {
      const p: DeckPatch["electrical"] = {};
      const said: string[] = [];
      if (cmd.timer !== undefined) {
        p.timer = cmd.timer;
        said.push(cmd.timer ? "The lights on a photocell timer." : "No timer on the lights.");
      }
      if (cmd.panelSide) {
        p.panelSide = cmd.panelSide;
        said.push(`The feed comes from the house's ${cmd.panelSide} end.`);
      }
      if (cmd.feedFt) {
        p.feedFt = Math.round(clamp(cmd.feedFt, ELECTRICAL_LIMITS.feedFt.min, ELECTRICAL_LIMITS.feedFt.max));
        said.push(`${p.feedFt} ft from the panel to the structure.`);
      }
      return out(patchDesign(d, { electrical: p }, settle), said, { flash: [{ label: "Panel to the structure" }], light: { label: "Panel to the structure", step: "step-electrical" } });
    }
    case "house": {
      let house = { ...d.house };
      const said: string[] = [];
      if (cmd.storeys) {
        house.storeys = cmd.storeys;
        said.push(cmd.storeys === 2 ? "A two-story house." : "A one-story house.");
      }
      if (cmd.roof) {
        house.roof = cmd.roof;
        said.push(`The house has a ${HOUSE_ROOF_LABEL[cmd.roof].toLowerCase()} roof.`);
      }
      if (cmd.siding) {
        house.siding = cmd.siding;
        said.push(`${SIDINGS.find((x) => x.id === cmd.siding)?.label ?? cmd.siding} siding.`);
      }
      if (cmd.roofColour) {
        house.roofColour = cmd.roofColour;
        said.push(`A ${(ROOF_COLOURS.find((x) => x.id === cmd.roofColour)?.label ?? cmd.roofColour).toLowerCase()} roof on the house.`);
      }
      if (cmd.wall) {
        house = quickWall(cmd.wall, d.shape, house);
        said.push(`${QUICK_WALL_LABEL[cmd.wall]}.`);
      }
      if (cmd.widthFt) {
        const past = Math.max(0, cmd.widthFt - d.shape.widthFt);
        house = { ...house, leftFt: halfFt(past / 2), rightFt: halfFt(past / 2) };
        said.push(cmd.widthFt > d.shape.widthFt ? `The house ${ftWords(cmd.widthFt)} wide — the deck centered on it, ${ftWords(past / 2)} of wall past each end.` : "The house wall is no wider than the deck.");
      }
      if (cmd.leftFt || cmd.rightFt) {
        if (cmd.leftFt) house = { ...house, leftFt: halfFt(clamp(amt(house.leftFt, cmd.leftFt), 0, 60)) };
        if (cmd.rightFt) house = { ...house, rightFt: halfFt(clamp(amt(house.rightFt, cmd.rightFt), 0, 60)) };
        said.push(`The house runs ${ftWords(house.leftFt)} past the deck on the left and ${ftWords(house.rightFt)} on the right.`);
      }
      const next = patchDesign(d, { house }, settle);
      return out(next, said, { flash: cmd.wall ? [{ label: "The wall's shape" }] : cmd.siding ? [{ label: "Siding" }] : cmd.roofColour ? [{ label: "Roof colour" }] : [{ label: "Storeys" }], view: { reset: true } });
    }
    case "extras": {
      const p: DeckPatch["extras"] = {};
      const said: string[] = [];
      if (cmd.demoSqFt !== undefined) {
        p.demoSqFt = cmd.demoSqFt === "deck" ? Math.round(shapeAreaSqFt(d.shape)) : Math.round(clamp(cmd.demoSqFt, DECK_LIMITS.demoSqFt.min, DECK_LIMITS.demoSqFt.max));
        said.push(p.demoSqFt ? `Tear-out of an old deck, ${p.demoSqFt} sq ft, in the price.` : "No tear-out.");
      }
      if (cmd.stainless !== undefined) {
        p.stainless = cmd.stainless;
        said.push(cmd.stainless ? "Stainless connectors and fasteners — what the code wants within 300 ft of salt water." : "Hot-dip galvanized connectors.");
      }
      if (cmd.drain !== undefined) {
        p.underDeckDrain = cmd.drain;
        if (cmd.drain && d.heightIn < 84) return no(`An under-deck drain makes a dry room below a high deck — this one is ${inWords(d.heightIn)} up. It needs about 7 ft under it.`);
        said.push(cmd.drain ? "An under-deck drainage system — a dry space below." : "No under-deck drainage.");
      }
      const next = patchDesign(d, { extras: p }, settle);
      return out(next, said, { flash: cmd.demoSqFt !== undefined ? [{ label: "Tear out an old deck" }] : [] });
    }
    case "item": {
      const items = [...d.extras.items];
      const key = cmd.name.toLowerCase();
      if (cmd.op === "remove") {
        const left = items.filter((it) => !it.name.toLowerCase().includes(key) && !key.includes(it.name.toLowerCase()));
        if (left.length === items.length) return no(`There's no ${cmd.name.toLowerCase()} on the list.`);
        return out(patchDesign(d, { extras: { items: left } }, settle), [`Took the ${cmd.name.toLowerCase()} off the price.`]);
      }
      const qty = Math.max(1, cmd.qty ?? 1);
      const price = cmd.price ?? 0;
      const i = items.findIndex((it) => it.name.toLowerCase() === key);
      if (i >= 0) items[i] = { ...items[i], qty: items[i].qty + qty, price: cmd.price ?? items[i].price };
      else {
        if (items.length >= 40) return no("The list of your own items is full (40).");
        let k = items.length + 1;
        while (items.some((it) => it.id === `i${k}`)) k++;
        items.push({ id: `i${k}`, name: cmd.name, qty, unit: cmd.unit ?? "ea", price });
      }
      const next = patchDesign(d, { extras: { items } }, settle);
      return out(next, [`Added ${qty > 1 ? `${qty} × ` : ""}${cmd.name.toLowerCase()} at $${price.toLocaleString("en-US")}${qty > 1 ? " each" : ""} — on the price and the material list as your own item. The 3D doesn't draw it.`], { meta: { remember: { name: cmd.name, unit: cmd.unit ?? "ea", price } } });
    }
    case "custom": {
      // As the studio's "Custom — type your own…": the list's own choice stays what it works like; the name and the price are the shop's.
      const p: DeckPatch = { custom: { [cmd.slot]: { name: cmd.name.slice(0, 80), price: cmd.slot === "species" ? 0 : Math.max(0, cmd.price) } } as DeckDesign["custom"] };
      if (cmd.slot === "fascia" && d.decking.fascia === "none") p.decking = { fascia: "match" };
      if ((cmd.slot === "ceiling" || cmd.slot === "gutters" || cmd.slot === "walls" || cmd.slot === "roofing" || cmd.slot === "roofFascia") && d.structure === "deck") return no("That goes on a roof — add one first (\"add a gable roof\").");
      if (cmd.slot === "ceiling" && d.roof.ceiling === "none") p.roof = { ...d.roof, ceiling: "tongue-groove" };
      if (cmd.slot === "gutters" && d.roof.gutters.kind === "none") p.roof = { ...d.roof, ...(p.roof ?? {}), gutters: { ...d.roof.gutters, kind: "k5" } };
      if (cmd.slot === "walls" && d.roof.walls.fill === "none") p.roof = { ...d.roof, ...(p.roof ?? {}), walls: { ...d.roof.walls, fill: "screen" } };
      const unit = cmd.slot === "decking" || cmd.slot === "fascia" || cmd.slot === "roofFascia" || cmd.slot === "gutters" ? "a foot" : cmd.slot === "roofing" ? "a square" : cmd.slot === "species" ? "" : "a square foot";
      const next = patchDesign(d, p, settle);
      return out(next, [`Your own ${cmd.slot === "roofFascia" ? "roof trim" : cmd.slot === "species" ? "framing lumber" : cmd.slot}: ${cmd.name}${unit ? ` at $${cmd.price.toLocaleString("en-US")} ${unit}` : ""}. It's built and drawn like the list's pick, priced as yours.`], { touched: cmd.slot === "decking" || cmd.slot === "species" ? [cmd.slot] : [] });
    }
    case "sample": {
      const sample = DECK_SAMPLES.find((x) => x.id === cmd.id);
      if (!sample) return no("I don't have that sample.");
      // As the studio lays a sample over the design: the sample, the house kept in agreement, the frame settled.
      let next = applyDeckPatch(d, sample.patch);
      const h2 = houseForShape(next.house, next.shape);
      if (h2 !== next.house) next = applyDeckPatch(next, { house: h2 });
      next = settle(next);
      return out(next, [`Started from "${sample.name}": ${sample.facts}. Your address, house and lumber are kept.`], { view: { reset: true, tab: "3d" } });
    }
    case "autofix": {
      const r0 = autoFixDesign(d, { rates: env.rates, market: env.market });
      // The code edition's reminder is not the deck's to fix.
      const r = { ...r0, left: r0.left.filter((c) => c.part !== "Code") };
      if (r.design === d || !r.fixes.length) return out(d, [r.left.length ? `Nothing I can fix on my own — ${r.left.length} ${r.left.length === 1 ? "check needs" : "checks need"} a person: ${r.left[0].part}: ${firstSentence(r.left[0].text)}` : "It passes — nothing to fix."]);
      return out(r.design, [`Fixed ${plural(r.fixes.length, "thing")}: ${r.fixes.slice(0, 3).join("; ")}${r.fixes.length > 3 ? "…" : ""}.${r.left.length ? ` Left for you: ${r.left[0].part} — ${firstSentence(r.left[0].text)}` : " It passes now."}`], { meta: { go: "checks" } });
    }
    case "reset": {
      const fresh = defaultDeckDesign({ state: d.site.state ?? env.homeState ?? null, frostIn: d.frostIn });
      return out(fresh, ["A new deck: 16 × 12 ft, 3 ft high, on the house."], { meta: { reset: true }, view: { reset: true, tab: "3d" } });
    }
    case "view": {
      const { do: _kind, ...view } = cmd;
      void _kind;
      return out(d, viewWords(cmd), { view });
    }
    case "keep":
      return out(d, [cmd.what ? `Keeping ${cmd.what.replace(/^(?:it|the) /, "the ")} as it is.` : "Take your time."]);
    case "open":
      return out(d, [cmd.what === "permit" ? "Opening the permit set." : cmd.what === "yard" ? "Opening the list for the lumber yard." : cmd.what === "installer" ? "Opening the installer's sheet." : cmd.what === "checks" ? "Here are the code checks." : "Here's the package and the price."], { meta: cmd.what === "package" ? { go: "package" } : cmd.what === "checks" ? { go: "checks" } : { open: cmd.what } });
    case "go":
      return out(d, [], { meta: { go: cmd.to } });
    case "name":
      return out(d, [`Named it "${cmd.title}".`], { meta: { name: cmd.title } });
    case "address":
      return out(d, [`Job address: ${cmd.text}. The state's code, the frost line and the snow follow it.`], { meta: { address: cmd.text } });
    case "save":
      return out(d, ["Make the proposal from this design now?"], { pending: { ask: "Make the proposal?", yes: [{ do: "save" }] }, meta: {} });
    case "help":
      return out(d, ['Say what you want, like "make it 20 by 14", "add stairs on the left", "composite in dark gray", "add a gable roof", "show me at night" or "how much concrete do I need?" — "undo" takes anything back.'], { meta: { help: true } });
    case "wish":
      return out(d, [cmd.item ? `The studio can't draw ${articled(cmd.item)} yet — I've noted it for the team. I can put it on the price as your own item: what does it cost? Say a price, like "1,200 dollars".` : "I can't do that one yet — I've noted it for the team."], { meta: { wish: { text: cmd.text, item: cmd.item } }, pending: cmd.item ? { ask: `The price of ${articled(cmd.item)}?`, yes: [], price: { item: cmd.item } } : null });
    case "teach":
      return out(d, [], { meta: { teach: { phrase: cmd.phrase, words: cmd.words } } });
    case "forget":
      return out(d, [cmd.phrase ? `Forgot "${cmd.phrase}".` : "Forgot the last thing you taught me."], { meta: { forget: { phrase: cmd.phrase } } });
    case "undo":
      return out(d, [], { meta: { undo: true } });
    case "redo":
      return out(d, [], { meta: { redo: true } });
    case "stop":
      return out(d, ["OK — tap the mic when you need me."], { meta: { stop: true } });
    case "mute":
      return out(d, [cmd.on ? "I'll answer in writing." : "I'll talk back."], { meta: { mute: cmd.on } });
    case "confirm":
    case "ask":
    case "show":
    case "whatif":
    case "compare":
      // Answered by the assistant (brain.ts), which has the price and the checks in hand.
      return out(d, []);
  }
}

const articled = (item: string) => `${/^[aeiou]/i.test(item) ? "an" : "a"} ${item.toLowerCase()}`;

function viewWords(v: Extract<DeckCommand, { do: "view" }>): string[] {
  const out: string[] = [];
  if (v.tab === "plan") out.push("The framing plan.");
  if (v.tab === "3d" && Object.keys(v).length === 2) out.push("The 3D view.");
  if (v.tab === "wall") out.push("The house and the deck from above.");
  if (v.xray === true) out.push("X-ray: the boards fade so you can see the frame.");
  if (v.xray === false) out.push("X-ray off.");
  if (v.night === true) out.push("Evening — the lights on.");
  if (v.night === false) out.push("Daytime.");
  if (v.connections) out.push("The numbered tags mark the connections — tap one to read how it's made.");
  if (v.build === "play") out.push("Here's how it goes together: footings, posts, beams, joists, then the boards and the rail.");
  if (v.build === "done") out.push("The finished deck.");
  if (v.full === true) out.push("Full view.");
  if (v.full === false) out.push("Back to the form.");
  if (v.look === "top") out.push("From above.");
  if (v.look === "under") out.push("From underneath — the framing.");
  if (v.look === "spin") out.push("All the way around.");
  if (v.look === "left" || v.look === "right") out.push(`From the ${v.look}.`);
  if (v.look === "front" || v.look === "yard") out.push("From the yard.");
  if (v.look === "house") out.push("From the house, looking out.");
  if (v.reset) out.push("The whole thing.");
  if (v.edit === true) out.push("Drag the knobs — the price follows.");
  return out;
}

type Out = (design: DeckDesign, said: string[], extra?: Omit<Outcome, "design" | "said">) => Outcome;
type No = (why: string, extra?: Omit<Outcome, "design" | "said">) => Outcome;

function runRoof(d0: DeckDesign, s: RoofSet, env: RunEnv, settle: (x: DeckDesign) => DeckDesign, out: Out, no: No): Outcome {
  const said: string[] = [];
  const flash: Flash[] = [];
  let light: FieldFocus | null = { label: "Roofing", step: "step-roof" };
  let d = d0;
  // A ROOF SHAPE ASKED FOR IS THE SHAPE BUILT (owner, 2026-10-22: "it doesn't understand the different shapes of the
  // roof — like a hip roof"). A bare deck gets a cover; a shape only a gazebo carries (pyramid, two-tier, gambrel, Dutch
  // gable) makes it a gazebo over the deck; a shed comes off a gazebo or a pergola onto a covered deck — the roof's
  // roofing, ceiling, gutters and trim kept.
  if (s.kind && s.kind !== "pergola") {
    const want = s.kind;
    const target = want === "shed" ? "covered-deck" : GAZEBO_ONLY.has(want) ? "gazebo" : d.structure === "gazebo" || d.structure === "covered-deck" ? d.structure : "covered-deck";
    if (target !== d.structure) {
      const was = d.structure;
      d = carryRoof(switchStructure(d, target), d.roof, was);
      if (target === "gazebo") said.push(`A ${kindWord(want)} roof stands on posts all around, so it's built as a gazebo${hasDeck(d) ? " over the deck" : ""}.`);
      else if (was === "gazebo" || was === "pergola") said.push(`A ${kindWord(want)} roof goes on a covered deck — the ${was} is now a covered deck.`);
      else said.push(`A covered deck with a ${kindWord(want)} roof.`);
    }
  } else if (d.structure === "deck") {
    return no("There's no roof yet — say \"add a gable roof\" or \"make it a covered deck\".", { pending: { ask: "Add a roof?", yes: [{ do: "structure", to: "covered-deck" }, { do: "roof", set: s }] } });
  }
  const switched = d !== d0;
  const r = d.roof;
  const p: Partial<RoofDesign> = {};
  if (s.kind && s.kind !== "pergola") {
    p.kind = s.kind;
    if (!switched) said.push(s.kind === r.kind && !env.freshRoof ? `It's already a ${kindWord(r.kind)} roof.` : `A ${kindWord(s.kind)} roof.`);
    if (said.length) said[said.length - 1] = said[said.length - 1].replace(/^a /, "A ");
    flash.push({ label: "Roof shape" });
  }
  if (s.pitch) {
    const PITCHES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
    const v = clamp(Math.round(amt(r.pitch, s.pitch)), ROOF_LIMITS.pitch.min, ROOF_LIMITS.pitch.max);
    p.pitch = PITCHES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    if (d.structure !== "pergola") said.push(`Pitch ${p.pitch}/12${p.pitch <= 3 ? " — low; shingles want 4/12 or more, so metal is the better roof here" : p.pitch >= 9 ? " — steep and tall" : ""}.`);
    flash.push({ label: "Pitch" });
    light = { label: "Pitch", step: "step-roof" };
  }
  if (s.eaveIn) {
    const v = Math.round(clamp(amt(r.eaveHeightIn, s.eaveIn), ROOF_LIMITS.eaveHeightIn.min, ROOF_LIMITS.eaveHeightIn.max));
    p.eaveHeightIn = v;
    said.push(`The headers at ${inWords(v)} above the floor${amt(r.eaveHeightIn, s.eaveIn) > ROOF_LIMITS.eaveHeightIn.max ? ` (the most is ${inWords(ROOF_LIMITS.eaveHeightIn.max)})` : ""}.`);
    flash.push({ label: "Height to the headers" });
    light = { label: "Height to the headers", step: "step-roof" };
  }
  if (s.overhangIn) {
    p.overhangIn = Math.round(clamp(amt(r.overhangIn, s.overhangIn), ROOF_LIMITS.overhangIn.min, ROOF_LIMITS.overhangIn.max));
    said.push(`${p.overhangIn} in. of overhang past the posts.`);
    flash.push({ label: "Overhang past the posts" });
    light = { label: "Overhang past the posts", step: "step-roof" };
  }
  if (s.roofing) {
    if (d.structure === "pergola") return no("A pergola has no roofing — it's open slats. Say \"make it a covered deck\" for shingles or metal.", { pending: { ask: "A covered deck with that roofing?", yes: [{ do: "structure", to: "covered-deck" }, { do: "roof", set: { roofing: s.roofing } }] } });
    p.roofing = s.roofing;
    said.push(`${ROOFING_LABEL[s.roofing]}.`);
    flash.push({ label: "Roofing" });
    light = { label: "Roofing", step: "step-roof" };
  }
  if (s.ceiling) {
    p.ceiling = s.ceiling;
    said.push(s.ceiling === "none" ? "Open ceiling — the rafters show." : s.ceiling === "beadboard" ? "A beadboard ceiling." : "A tongue-and-groove ceiling.");
    flash.push({ label: "Ceiling" });
    light = { label: "Ceiling", step: "step-roof" };
  }
  if (s.gutters || s.guards !== undefined) {
    p.gutters = { kind: s.gutters ?? r.gutters.kind, guards: s.guards ?? r.gutters.guards };
    said.push(p.gutters.kind === "none" ? "No gutters." : `${p.gutters.kind === "k5" ? "5-in. K-style" : p.gutters.kind === "k6" ? "6-in. K-style" : p.gutters.kind === "half-round-alum" ? "Half-round aluminum" : "Half-round copper"} gutters${p.gutters.guards ? " with guards" : ""}.`);
    flash.push({ label: "Gutters" });
    light = { label: "Gutters", step: "step-roof" };
  }
  if (s.cupola !== undefined) {
    p.cupola = s.cupola;
    said.push(s.cupola ? "A cupola at the peak." : "No cupola.");
    light = { label: "Cupola at the peak" };
  }
  if (s.soffit !== undefined) {
    p.soffit = s.soffit;
    said.push(s.soffit ? "A vented soffit under the overhang." : "No soffit.");
  }
  if (s.fasciaFinish) {
    p.fascia = { ...r.fascia, finish: s.fasciaFinish };
    said.push(s.fasciaFinish === "pvc" ? "PVC trim boards." : s.fasciaFinish === "aluminum-wrap" ? "Aluminum-wrapped trim." : "Painted wood trim.");
  }
  if (s.walls || s.wallSides) {
    const fill = s.walls ?? r.walls.fill;
    p.walls = { fill, sides: s.wallSides ?? r.walls.sides };
    said.push(fill === "none" ? "Open between the posts." : `${WALL_FILL_LABEL[fill]} on ${plural(Math.min(p.walls.sides, 16), "side")}.`);
    flash.push({ label: "Walls between the posts" });
    light = { label: "Walls between the posts", step: "step-roof" };
  }
  if (s.pergolaStyle) {
    if (d.structure !== "pergola") return no("Louvers and arched rafters are a pergola's top — make it a pergola?", { pending: { ask: "Make it a pergola?", yes: [{ do: "structure", to: "pergola" }, { do: "roof", set: { pergolaStyle: s.pergolaStyle } }] } });
    p.pergolaStyle = s.pergolaStyle;
    said.push(s.pergolaStyle === "louvered" ? "Louvers that turn — open for sun, shut for shade." : s.pergolaStyle === "arched" ? "Arched rafters." : "Flat slats on top.");
    flash.push({ label: "Pergola top" });
  }
  if (s.slatSize || s.slatSpacingIn) {
    p.slats = { size: s.slatSize ?? r.slats.size, spacingIn: Math.round(clamp(amt(r.slats.spacingIn, s.slatSpacingIn), ROOF_LIMITS.slatSpacingIn.min, ROOF_LIMITS.slatSpacingIn.max)) };
    said.push(`${p.slats.size} slats ${p.slats.spacingIn} in. apart.`);
    flash.push({ label: "Slats" });
    light = { label: "Slats", step: "step-roof" };
  }
  if (s.planShape) {
    p.plan = { ...(p.plan ?? r.plan), shape: s.planShape };
    // A square or a rectangle named without a size: as big as the deck under it allows.
    if (hasDeck(d) && !s.widthFt && (s.planShape === "square" || s.planShape === "rect") && r.plan.shape === "follows-deck") {
      const sq = Math.max(8, Math.floor(Math.min(d.shape.widthFt, d.shape.depthFt)) - 1);
      p.plan = { ...p.plan, widthFt: s.planShape === "square" ? sq : d.shape.widthFt, depthFt: s.planShape === "square" ? sq : d.shape.depthFt };
    }
    said.push(s.planShape === "follows-deck" ? "The roof over the whole deck." : `${articled(s.planShape === "rect" ? "rectangular" : s.planShape)} roof.`.replace(/^a/, "A"));
    flash.push({ label: "Roof outline" });
  }
  if (s.widthFt || s.depthFt || s.acrossFt || s.offsetFt) {
    const pl = p.plan ?? r.plan;
    p.plan = {
      ...pl,
      widthFt: clamp(halfFt(amt(pl.widthFt, s.widthFt)), ROOF_LIMITS.planFt.min, ROOF_LIMITS.planFt.max),
      depthFt: clamp(halfFt(amt(pl.depthFt, s.depthFt)), ROOF_LIMITS.planFt.min, ROOF_LIMITS.planFt.max),
      acrossFt: clamp(halfFt(amt(pl.acrossFt, s.acrossFt)), ROOF_LIMITS.acrossFt.min, ROOF_LIMITS.acrossFt.max),
      offsetFt: clamp(halfFt(amt(pl.offsetFt, s.offsetFt)), ROOF_LIMITS.offsetFt.min, ROOF_LIMITS.offsetFt.max),
    };
    said.push(s.acrossFt ? `${ftWords(p.plan.acrossFt)} across.` : `The roof ${ftWords(p.plan.widthFt)} × ${ftWords(p.plan.shape === "square" ? p.plan.widthFt : p.plan.depthFt)}.`);
  }
  if (s.attach) {
    p.attach = s.attach;
    flash.push({ label: "On the house or free" });
  }
  if (s.post) {
    p.post = s.post;
    said.push(`${s.post} roof posts.`);
    light = { label: "Posts", step: "step-roof" };
  }
  if (s.header) {
    p.header = s.header;
    said.push(s.header === "lvl" ? "Engineered LVL headers throughout." : s.header === "auto" ? "Headers picked by the tables, least cost." : `${s.header} headers.`);
    light = { label: "Headers", step: "step-roof" };
  }
  if (s.rafter || s.rafterSpacingIn) {
    if (s.rafter) p.rafter = s.rafter;
    if (s.rafterSpacingIn) p.rafterSpacingIn = s.rafterSpacingIn;
    said.push(`Rafters ${s.rafter && s.rafter !== "auto" ? s.rafter : "sized by the tables"}${s.rafterSpacingIn ? ` at ${s.rafterSpacingIn} in. on center` : ""}.`);
    flash.push({ label: "Rafters" });
    light = { label: "Rafters", step: "step-roof" };
  }
  if (s.load) {
    p.load = s.load;
    said.push(s.load === "auto" ? "The roof load follows the ground snow here." : s.load === 20 ? "Built for a 20 psf roof live load." : `Built for ${s.load} psf of snow on the roof.`);
  }
  if (s.roofDeck) {
    p.roofDeck = s.roofDeck;
    if (r.roofing !== "metal-panel" && r.roofing !== "standing-seam" && s.roofDeck === "purlins") said.push("Purlins go under metal roofing — switched to metal panels.");
    if (r.roofing !== "metal-panel" && r.roofing !== "standing-seam" && s.roofDeck === "purlins") p.roofing = "metal-panel";
    said.push(s.roofDeck === "purlins" ? "The metal on purlins across the rafters." : "The roofing on sheathing.");
  }
  if (s.fasciaEave !== undefined || s.fasciaRake !== undefined) {
    p.fascia = { ...(p.fascia ?? r.fascia), ...(s.fasciaEave !== undefined ? { eave: s.fasciaEave } : {}), ...(s.fasciaRake !== undefined ? { rake: s.fasciaRake } : {}) };
    said.push(`${s.fasciaEave !== undefined ? (s.fasciaEave ? "Fascia on the eaves." : "No fascia on the eaves.") : ""}${s.fasciaRake !== undefined ? (s.fasciaRake ? " Rake boards on the gable ends." : " No rake boards.") : ""}`.trim());
  }
  if (s.ridge) p.ridge = s.ridge;
  if (s.crossBeams !== undefined) p.crossBeams = clamp(s.crossBeams, ROOF_LIMITS.crossBeams.min, ROOF_LIMITS.crossBeams.max);
  if (s.braces !== undefined) {
    p.braces = s.braces;
    said.push(s.braces ? "Knee braces at the posts." : "No knee braces at the posts.");
  }
  const next = patchRoof(d, p, settle);
  const nr = next.roof;
  if (s.attach && nr.attach !== s.attach) said.push(s.attach === "wall" ? "This roof can't hang on the house — it stands on its own posts." : "It stands on its own posts.");
  else if (s.attach) said.push(nr.attach === "wall" ? "The back of the roof hangs on the house wall." : "On its own posts, free of the house.");
  // What the frame really is: the 3D shows the built roof, so the words say it too.
  let pending: Pending | null = null;
  if (p.kind) {
    const built = buildStructure(next, { rates: env.rates, market: env.market }).roof;
    if (built && built.kind !== p.kind) {
      const W = next.shape.widthFt;
      const D = next.shape.depthFt;
      // The posts stand a few inches inside the deck's edges: a square a foot under its short side stays square.
      const side = Math.max(8, Math.floor(Math.min(W, D)) - 1);
      const plan = next.roof.plan.shape;
      if (p.kind === "hip" && built.kind === "pyramid") said.push(plan === "hexagon" || plan === "octagon" || plan === "round" ? `On ${articled(plan === "round" ? "round" : plan)} outline every side slopes up to one peak — a pyramid roof.` : "On a square the four hips meet at one point — that's a pyramid roof.");
      else if (p.kind === "pyramid" && built.kind === "hip") {
        said.push(`A pyramid needs a square: over ${ftWords(W)} × ${ftWords(D)} the four sides meet at a short ridge — a hip roof. Say "square roof" for a true pyramid over ${ftWords(side)} × ${ftWords(side)}.`);
        pending = { ask: "A square roof, a true pyramid?", yes: [{ do: "roof", set: { planShape: "square", widthFt: { to: side } } }] };
      } else if (p.kind === "dutch-gable" && built.kind === "hip") said.push("A Dutch gable needs it longer one way than the other — on a square it frames as a hip.");
      else said.push(`On this outline it frames as a ${kindWord(built.kind)} roof.${built.kindNote ? ` ${built.kindNote}` : ""}`);
    }
  }
  return out(next, said.length ? said : ["Done."], { flash, light, pending, view: p.kind ? { tab: "3d", reset: true } : undefined });
}

function runDecking(d: DeckDesign, s: DeckingSet, env: RunEnv, settle: (x: DeckDesign) => DeckDesign, out: Out, no: No): Outcome {
  if (!hasDeck(d)) return no("There are no deck boards here — it stands on a slab or the ground.");
  const now = deckingProduct(d.decking.product);
  const state = d.site.state ?? env.homeState ?? null;
  const p: DeckPatch = {};
  const said: string[] = [];
  const flash: Flash[] = [];
  let product: DeckingProduct | null = null;
  if (s.product) product = deckingProduct(s.product);
  else if (s.family) {
    if (s.family === "composite") product = now.family === "composite" ? now : deckingProduct("composite-better");
    else if (s.family === "treated") {
      const base = treatedDecking(state);
      const west = /hemfir/.test(base);
      const id = s.thick === "2x6" ? (west ? "pt-hemfir-2x6" : "pt-pine-2x6") : s.thick === "54" ? (west ? "pt-hemfir-54" : "pt-pine-54") : base;
      product = deckingProduct(id);
    } else if (s.family === "modified") product = deckingProduct("thermo-ash-54");
    else product = DECKING.find((x) => x.family === s.family) ?? null;
  }
  if (s.tier) {
    const tierBoard = s.tier === "good" ? treatedDecking(state) : s.tier === "better" ? "composite-better" : "composite-best";
    const tierRail = s.tier === "good" ? "treated" : s.tier === "better" ? "composite" : "aluminum";
    product = deckingProduct(tierBoard);
    const railOn = d.rail.type !== "none" || buildStructure(d).rails.required;
    if (railOn) p.rail = { type: tierRail };
    said.push(s.tier === "good" ? "The Good package: treated boards and a wood rail." : s.tier === "better" ? "The Better package: capped composite, composite rail." : "The Best package: premium composite with an aluminum rail.");
  }
  // Said after the switch, so the reply opens with what the boards are now.
  let familyNote: string | null = null;
  if (s.color) {
    const was = product ?? now;
    const pick = boardForColor(was, s.color);
    if (pick) {
      product = pick.product;
      // Said of the boards it was ("dark gray" on a PVC board used to answer "Wood doesn't come dark gray").
      if (pick.switchedFamily && !s.product && !s.family) familyNote = WOOD.has(was.family) ? `Wood doesn't come ${s.color} — that color is a capped board's.` : `No ${FAMILY_NOUN[was.family]} board on the list comes in ${s.color}.`;
    }
  }
  if (s.shade) {
    const from = product ?? now;
    const pick = boardShade(from, s.shade);
    if (!pick) return no(`That's the ${s.shade === "lighter" ? "lightest" : "darkest"} board of its kind.`);
    if (from.brand && pick.brand !== from.brand) said.push(`${from.brand} has nothing ${s.shade} than ${from.label.replace(`${from.brand} `, "")}.`);
    product = pick;
  }
  if (product && (product.id !== now.id || d.custom.decking)) {
    p.decking = { ...(p.decking ?? {}), product: product.id };
    p.custom = { decking: undefined };
    said.push(product.id === now.id ? `${boardWords(product)}.` : `Switched to ${boardWords(product)}.`);
    if (familyNote) said.push(familyNote);
    flash.push({ label: "Deck boards" });
  } else if (product && product.id === now.id && !s.tier) said.push(`It's already ${product.label}.`);
  if (s.pattern) {
    p.decking = { ...(p.decking ?? {}), pattern: s.pattern, diagonal: s.pattern !== "straight" };
    said.push(s.pattern === "straight" ? "Boards straight across the joists." : s.pattern === "diagonal" ? "Boards on a 45° diagonal — the joists go to 12 in. apart for them." : "A herringbone pattern — the boards meet at 45° down the middle.");
    flash.push({ label: "Pattern" });
  }
  if (s.border !== undefined) {
    p.decking = { ...(p.decking ?? {}), border: s.border };
    said.push(s.border ? `A picture-frame border, ${plural(s.border, "row")} of boards along every open edge — toned a shade deeper in the 3D so the frame shows.` : "No border.");
    flash.push({ label: "Picture-frame border" });
  }
  if (s.fastening) {
    p.decking = { ...(p.decking ?? {}), fastening: s.fastening };
    const prod = product ?? now;
    if (s.fastening === "hidden" && !prod.hiddenFasteners) said.push(`${prod.label} has no grooved edge for clips — it's face-screwed.`);
    else said.push(s.fastening === "hidden" ? "Hidden clips — no screw heads on top." : "Face screws.");
    flash.push({ label: "Fastened with" });
  }
  if (s.fascia) {
    p.decking = { ...(p.decking ?? {}), fascia: s.fascia };
    said.push(s.fascia === "none" ? "No fascia — the rim shows." : "Fascia boards matching the decking over the rim.");
    flash.push({ label: "Fascia" });
  }
  if (s.wastePct !== undefined) {
    p.decking = { ...(p.decking ?? {}), wastePct: clamp(Math.round(s.wastePct), DECK_LIMITS.wastePct.min, DECK_LIMITS.wastePct.max) };
    said.push(`${p.decking.wastePct}% waste on the boards.`);
    flash.push({ label: "Waste" });
  }
  if (!Object.keys(p).length) return out(d, said.length ? said : ["It's already that."]);
  const next = patchDesign(d, p, settle);
  return out(next, said, { flash, light: s.border !== undefined ? { label: "Picture-frame border" } : s.fascia ? { label: "Fascia", step: "Surface" } : { label: "Deck boards", step: "Surface" }, touched: p.decking?.product ? ["decking"] : [] });
}

function runRail(d: DeckDesign, s: import("./commands").RailSet, settle: (x: DeckDesign) => DeckDesign, out: Out, no: No): Outcome {
  if (!hasDeck(d)) return no("There's no deck edge for a railing here.");
  const p: DeckPatch["rail"] = {};
  const said: string[] = [];
  const touched: string[] = [];
  if (s.type) {
    if (s.type === "custom" && !s.customPerFt && !d.rail.customPerFt) return no("What does your railing cost per foot, installed? Say \"custom railing at 95 dollars a foot\".");
    p.type = s.type;
  }
  if (s.heightIn) {
    p.heightIn = s.heightIn;
    touched.push("railHeight");
  }
  if (s.infill) p.infill = s.infill;
  if (s.postSpacingFt) p.postSpacingFt = s.postSpacingFt;
  if (s.cap !== undefined) p.cap = s.cap;
  if (s.lowerLevel !== undefined) p.lowerLevel = s.lowerLevel;
  if (s.customPerFt !== undefined) p.customPerFt = s.customPerFt;
  if (s.customName) p.customName = s.customName;
  // The mount: every side — one side's own goes with it — or one side alone, kept apart only where it differs from the rest.
  if (s.mount && !s.mountSide) {
    p.mount = s.mount;
    p.mountBy = {};
  } else if (s.mount && s.mountSide) {
    const key = `upper-${s.mountSide}` as RailSectionKey;
    const by = { ...d.rail.mountBy };
    if (railMountFor(p.type ?? d.rail.type, d.rail.mount) === s.mount) delete by[key];
    else by[key] = s.mount;
    p.mountBy = by;
  }
  const next = patchDesign(d, { rail: p }, settle);
  const rails = buildStructure(next).rails;
  if (s.type === "none") {
    said.push(rails.required ? "No railing in the price — but it's over 30 in. up, so the code wants a guard. I'd keep one." : "No railing.");
  } else {
    const label = next.rail.type === "custom" ? next.rail.customName || "Your own railing" : rails.label;
    said.push(`${label}, ${next.rail.heightIn} in. high${rails.lf ? `, ${Math.round(rails.lf)} ft around the open edges` : ""}${next.rail.cap && rails.system === "wood" ? ", with a 2x6 cap" : ""}.`);
    if (s.postSpacingFt) said.push(`Posts every ${next.rail.postSpacingFt} ft.`);
    if (s.mount) {
      if (!rails.posts) said.push("There is no rail along the deck's edges to mount yet.");
      else if (s.mountSide && !rails.mounts[`upper-${s.mountSide}`]) said.push(`There is no rail on the ${s.mountSide} to mount.`);
      else said.push(`The railing is ${railMountLine(rails)}: ${rails.topPosts ? "a top-mounted post stands on the boards over blocking" : ""}${rails.topPosts && rails.sidePosts ? "; " : ""}${rails.sidePosts ? "a side-mounted post hangs on the outside of the rim" : ""}.`);
    }
  }
  return out(next, said, { touched, flash: [{ label: s.mount ? "How the posts are mounted" : s.heightIn ? "Rail height" : "Your railing" }] });
}

function runStairs(d: DeckDesign, cmd: Extract<DeckCommand, { do: "stairs" }>, settle: (x: DeckDesign) => DeckDesign, out: Out, no: No): Outcome {
  if (!hasDeck(d)) return no("There's no deck to step down from.");
  const list = d.stairs;
  const pick = (which: typeof cmd.which): StairDesign[] => {
    if (!list.length) return [];
    if (!which || which === "only" || which === "last") return [list[list.length - 1]];
    if (which === "all") return list;
    if ("index" in which) return list[which.index] ? [list[which.index]] : [];
    return list.filter((s) => s.side === which.side);
  };
  if (cmd.op === "add") {
    if (list.length >= STAIR_LIMITS.count) return no(`That's the most stairs a deck takes here (${STAIR_LIMITS.count}).`);
    if (cmd.level === "lower" && !d.lower.on) return no("There's no lower level yet — say \"add a lower level\" first.", { pending: { ask: "Add a lower level?", yes: [{ do: "lower", on: true }] } });
    if (cmd.wrap && d.heightIn > 24) return no(`Box steps wrap a low deck — up to 3 steps. At ${inWords(d.heightIn)} it needs a regular stair. Add one down the front?`, { pending: { ask: "A regular stair down the front?", yes: [{ do: "stairs", op: "add", side: "front" }] } });
    const sides: StairSide[] = cmd.count === 2 && !cmd.side ? ["left", "right"] : Array.from({ length: Math.max(1, Math.min(cmd.count ?? 1, STAIR_LIMITS.count - list.length)) }, () => cmd.side ?? (cmd.wrap ? "front" : "front"));
    let stairs = [...list];
    const added: StairDesign[] = [];
    sides.forEach((side, i) => {
      const id = nextStairId(stairs);
      const level = cmd.level ?? "upper";
      const width = clamp(Math.round(amt(4, cmd.width) * 2) / 2, STAIR_LIMITS.widthFt.min, STAIR_LIMITS.widthFt.max);
      const L = sideLength(d, side, level);
      const st0: StairDesign = { ...defaultStair(id, side, L / 2), widthFt: width, level };
      // Down the front: in the middle, or the spot asked for; on a side: toward the yard end, clear of the house.
      let atFt = side === "front" ? L / 2 : Math.max(width / 2, L - width / 2 - 1);
      if (sides.length > 1 && side === "front") atFt = (L * (i + 1)) / (sides.length + 1);
      if (cmd.at) atFt = stairAt(d, { ...st0, atFt }, cmd.at);
      const st: StairDesign = { ...st0, atFt, wrap: !!cmd.wrap && side === "front", wrapSides: cmd.wrapSides ?? 1, landing: cmd.landing ?? "pad", handrail: cmd.handrail ?? "auto" };
      if (st.wrap) stairs = stairs.filter((x) => !x.wrap);
      stairs.push(st);
      added.push(st);
    });
    const next = patchDesign(d, { stairs }, settle);
    const kept = added.filter((a) => next.stairs.some((x) => x.id === a.id));
    if (!kept.length) return no("I couldn't fit stairs there.");
    const first = next.stairs.find((x) => x.id === kept[0].id)!;
    const words = first.wrap ? `Box steps ${first.wrapSides === 1 ? "along the whole front" : `around ${first.wrapSides} sides`}` : `${kept.length > 1 ? `${kept.length} stairs` : `A ${ftWords(first.widthFt)}-wide stair`} ${kept.length > 1 ? kept.map((k) => SIDE_SAY[k.side]).join(" and ") : SIDE_SAY[first.side]}${first.level === "lower" ? " from the lower level" : ""}`;
    const detail = stairWords(next, first.id);
    return out(next, [`${words}${detail ? ` — ${detail}` : ""}.`], { fly: stairPoint(next, first.id), flash: [{ label: "Down the", section: "stairs" }], view: { tab: "3d" } });
  }
  const targets = pick(cmd.which);
  if (!targets.length) return no(list.length ? "I don't see those stairs." : "There are no stairs yet — say \"add stairs\".");
  if ((cmd.at === "house" || cmd.at === "out") && !cmd.side && targets.every((t) => t.side === "front")) return no("Stairs down the front come straight off the front edge. To bring them near the house, put them on a side — say \"move them to the left side\".", { pending: { ask: "Move them to the left side?", yes: [{ do: "stairs", op: "change", which: cmd.which, side: "left", at: cmd.at }] } });
  if (cmd.op === "remove") {
    const ids = new Set(targets.map((t) => t.id));
    const next = patchDesign(d, { stairs: list.filter((s) => !ids.has(s.id)) }, settle);
    return out(next, [targets.length === list.length && targets.length > 1 ? "Took all the stairs off." : `Took the stairs ${SIDE_SAY[targets[0].side]} off.`]);
  }
  const ids = new Set(targets.map((t) => t.id));
  const stairs = list.map((st) => {
    if (!ids.has(st.id)) return st;
    let s2: StairDesign = { ...st };
    if (cmd.flip) {
      if (s2.side === "left") s2.side = "right";
      else if (s2.side === "right") s2.side = "left";
      else s2.atFt = sideLength(d, "front", s2.level) - s2.atFt;
    }
    if (cmd.side && cmd.side !== s2.side) {
      const L = sideLength(d, cmd.side, s2.level);
      s2 = { ...s2, side: cmd.side, atFt: cmd.side === "front" ? L / 2 : Math.max(s2.widthFt / 2, L - s2.widthFt / 2 - 1) };
    }
    if (cmd.width) {
      const w2 = clamp(Math.round(amt(s2.widthFt, cmd.width) * 2) / 2, STAIR_LIMITS.widthFt.min, STAIR_LIMITS.widthFt.max);
      s2 = { ...s2, widthFt: w2 };
    }
    if (cmd.at) s2.atFt = stairAt(d, s2, cmd.at);
    if (cmd.wrap !== undefined) {
      s2.wrap = cmd.wrap && s2.side === "front";
      if (cmd.wrapSides) s2.wrapSides = cmd.wrapSides;
    }
    if (cmd.landing) s2.landing = cmd.landing;
    if (cmd.handrail) s2.handrail = cmd.handrail;
    if (cmd.level) s2.level = cmd.level;
    return s2;
  });
  const next = patchDesign(d, { stairs }, settle);
  const t = next.stairs.find((x) => x.id === targets[0].id);
  if (!t) return no("Those stairs don't fit there.");
  const said: string[] = [];
  if (cmd.side || cmd.flip) said.push(`Moved the stairs ${t.side === "front" ? "to the front" : `to the ${t.side} side`}.`);
  if (cmd.at && !cmd.side) {
    const gap = Math.max(0, t.atFt - t.widthFt / 2);
    const from = t.side === "front" ? "left end" : "house";
    said.push(cmd.at === "center" ? `Centered the stairs on the ${t.side === "front" ? "front" : `${t.side} side`}.` : gap < 0.5 ? `The stairs sit right at the ${from} now.` : `The stairs sit ${ftWords(gap)} from the ${from} now.`);
  }
  if (cmd.width) said.push(`Stairs ${ftWords(t.widthFt)} wide.`);
  if (cmd.wrap !== undefined) said.push(t.wrap ? "Box steps along the front." : "A regular flight.");
  if (cmd.landing) said.push(cmd.landing === "pad" ? "Onto a new concrete pad." : cmd.landing === "patio" ? "Onto the existing patio." : "Onto pavers.");
  if (cmd.handrail) said.push(cmd.handrail === "both" ? "Handrails on both sides." : cmd.handrail === "one" ? "One handrail." : cmd.handrail === "none" ? "No handrail — the code wants one at 4 risers or more." : "Handrails where the code wants them.");
  const detail = stairWords(next, t.id);
  if (detail && (cmd.width || cmd.side)) said.push(`${detail[0].toUpperCase()}${detail.slice(1)}.`);
  return out(next, said.length ? said : ["Done."], { fly: stairPoint(next, t.id), flash: [{ label: cmd.width ? "Width" : "Down the", section: "stairs" }] });
}

function runFixture(d: DeckDesign, cmd: Extract<DeckCommand, { do: "fixture" }>, settle: (x: DeckDesign) => DeckDesign, out: Out, no: No): Outcome {
  const list = [...d.electrical.fixtures];
  const needsRoof = cmd.kind === "ceiling-light" || cmd.kind === "chandelier" || cmd.kind === "fan";
  const [one, many] = FIXTURE_SAY[cmd.kind];
  if (cmd.op === "add" && needsRoof && d.structure === "deck") return no(`A ${one} needs a roof over it. Add a covered roof and the ${many}?`, { pending: { ask: `Add a roof and the ${one}?`, yes: [{ do: "structure", to: "covered-deck" }, cmd] } });
  if (cmd.op === "add" && needsRoof && d.structure === "pergola" && cmd.kind !== "chandelier") return no(`A pergola's open slats can't carry a ${one} — string lights or a chandelier hang from it. Want string lights?`, { pending: { ask: "String lights?", yes: [{ do: "fixture", op: "add", kind: "string-light" }] } });
  const have = list.filter((f) => f.kind === cmd.kind);
  const haveQty = have.reduce((a, f) => a + f.qty, 0);
  let fixtures: Fixture[];
  let words: string;
  if (cmd.op === "remove") {
    if (!have.length) return no(`There are no ${many} on it.`);
    fixtures = list.filter((f) => f.kind !== cmd.kind);
    words = `Took the ${many} off.`;
  } else if (cmd.op === "set") {
    if (!have.length && !cmd.qty) return no(`There are no ${many} on it yet.`);
    const total = Math.round(clamp(amt(haveQty || 0, cmd.qty), 0, ELECTRICAL_LIMITS.qty.max));
    if (total === 0) {
      fixtures = list.filter((f) => f.kind !== cmd.kind);
      words = `Took the ${many} off.`;
    } else {
      // The kind's count is carried by its first fixture; the rest of that kind fold into it.
      const firstIdx = list.findIndex((f) => f.kind === cmd.kind);
      const base = firstIdx >= 0 ? list[firstIdx] : defaultFixture(`e${list.length + 1}v`, cmd.kind);
      const kept: Fixture = { ...base, qty: total, ...(cmd.supply ? { supply: cmd.supply } : {}), ...(cmd.volts240 !== undefined ? { volts240: cmd.volts240 } : {}) };
      fixtures = [];
      list.forEach((f, i) => {
        if (f.kind !== cmd.kind) fixtures.push(f);
        else if (i === firstIdx) fixtures.push(kept);
      });
      if (firstIdx < 0) fixtures.push(kept);
      words = `${total} ${total === 1 ? one : many}${cmd.supply === "client" ? ` — the client buys ${total === 1 ? "it" : "them"}; drawn as a sample` : ""}${cmd.volts240 ? ", 240-volt" : cmd.volts240 === false ? ", 120-volt" : ""}.`;
    }
  } else {
    if (list.length >= ELECTRICAL_LIMITS.fixtures) return no(`That's the most fixtures a design holds (${ELECTRICAL_LIMITS.fixtures}).`);
    const qty = Math.round(clamp(amt(0, cmd.qty) || 1, 1, ELECTRICAL_LIMITS.qty.max));
    const open = have.find((f) => f.at === null && f.supply === (cmd.supply ?? "we"));
    if (open && cmd.kind !== "led-strip" && cmd.kind !== "post-cap" && cmd.kind !== "step-light") {
      fixtures = list.map((f) => (f.id === open.id ? { ...f, qty: Math.min(ELECTRICAL_LIMITS.qty.max, f.qty + qty), ...(cmd.volts240 !== undefined ? { volts240: cmd.volts240 } : {}) } : f));
    } else if (have.length && (cmd.kind === "led-strip" || cmd.kind === "post-cap" || cmd.kind === "step-light")) {
      return out(d, [`The ${many} are already on — they follow the ${cmd.kind === "step-light" ? "stairs" : cmd.kind === "post-cap" ? "rail posts" : "rails and headers"}.`], { light: { label: FIXTURE_LABEL[cmd.kind], step: "step-electrical", fixture: have[0].id }, view: { night: true } });
    } else {
      let k = list.length + 1;
      while (list.some((f) => f.id === `e${k}v`)) k++;
      fixtures = [...list, { ...defaultFixture(`e${k}v`, cmd.kind), qty, ...(cmd.supply ? { supply: cmd.supply } : {}), ...(cmd.volts240 !== undefined ? { volts240: cmd.volts240 } : {}) }];
    }
    const per = cmd.kind === "post-cap" ? "on every rail post" : cmd.kind === "step-light" ? "on the stair risers" : cmd.kind === "led-strip" ? "under the rail cap" : cmd.kind === "string-light" ? "post to post" : cmd.kind === "heater" ? (d.structure !== "deck" && d.structure !== "pergola" ? "on the headers" : "on a post") : cmd.kind === "outlet" ? "on a post, GFCI" : cmd.kind === "ceiling-light" ? "in the ceiling" : cmd.kind === "chandelier" ? "at the peak" : "";
    words = `Added ${cmd.kind === "post-cap" || cmd.kind === "step-light" || cmd.kind === "led-strip" ? many : qty === 1 ? articled(one) : `${qty} ${many}`}${per ? ` ${per}` : ""}${cmd.kind === "heater" ? (cmd.volts240 ? ", 240-volt (4 kW)" : ", 120-volt (1.5 kW)") : ""}${cmd.supply === "client" ? " — the client supplies it, drawn as a sample" : ""}.`;
  }
  const next = patchDesign(d, { electrical: { fixtures } }, settle);
  const lit = next.electrical.fixtures.find((f) => f.kind === cmd.kind);
  const lightish = cmd.kind !== "outlet" && cmd.kind !== "fan";
  return out(next, [words], { light: lit ? { label: FIXTURE_LABEL[cmd.kind], step: "step-electrical", fixture: lit.id } : null, view: lightish && cmd.op !== "remove" ? { night: true } : undefined, flash: [{ label: "What", section: "extras" }] });
}
