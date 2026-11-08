// THE MATERIAL PACKAGE (2026-10-04; the roof 2026-10-10; stairs, rails, levels and the electrical M3 2026-10-10) — pure.
//
// Owner: "it calculates the sizes, quantities you need, and it gives you the
// breakdown, the material package." The whole structure (structure.ts) goes
// in; out comes what to load on the truck: lumber as the yard sells it (a
// stock length per stick, short pieces cut several from one board), every
// connector and fastener, flashing for the ledgers, tape for the joists,
// concrete by the bag, sheathing by the sheet, shingles by the square, gutter
// by the foot with its hangers, the stairs' stringers and treads, the rails'
// posts and balusters, the wire, boxes and fixtures of the electrical.
//
// Each line names the price-book row it is bought on (rates.ts) and how
// many of that row's units it is, so pricing.ts prices the list without
// knowing what a joist is — and the list on the screen, the price and the
// proposal read the same quantities. Two levels of deck share lines: a 2x10
// is a 2x10 whichever level it frames.
//
// Lines are filed under the step of the job they belong to; the proposal's
// lines are those steps.

import { PIER_BLOCK, STOCK_LENGTHS_FT, type DeckFrame, type Stick, type StickRole } from "./frame";
import type { DeckSurface } from "./surface";
import { LEDGER_FASTENER_LABEL, ftIn, type LedgerFastener } from "./codeTables";
import { POST_HARDWARE_FACTOR, STAINLESS_FACTOR, lumberKey, tubeFactor } from "./rates";
import type { RoofMember, RoofRole } from "./roof";
import { type CustomSlot, ROOFING_LABEL, type DeckDesign } from "./design";
import type { DeckStructure } from "./structure";
import { structureLevels } from "./structure";
import { BOX_FRAME_NOMINAL, STRINGER_NOMINAL } from "./stairs";
import { BALUSTER_NOMINAL, RAIL_CAP_NOMINAL, RAIL_POST_NOMINAL, RAIL_TOP_NOMINAL } from "./rails";
import { FIXTURE_LABEL, type FixtureKind } from "./design";

export type BomStep = "footings" | "ledger" | "framing" | "decking" | "fascia" | "stairs" | "rails" | "drainage" | "slab" | "roof-posts" | "roof-frame" | "roof-deck" | "roofing" | "trim" | "ceiling" | "gutters" | "walls" | "cupola" | "electrical" | "own";
export const BOM_STEP_LABEL: Record<BomStep, string> = {
  footings: "Footings and posts",
  ledger: "Ledger and flashing",
  framing: "Framing",
  decking: "Decking",
  fascia: "Fascia",
  stairs: "Stairs",
  rails: "Railing",
  drainage: "Under-deck drainage",
  slab: "Concrete slab",
  "roof-posts": "Roof posts",
  "roof-frame": "Roof framing",
  "roof-deck": "Roof deck",
  roofing: "Roofing",
  trim: "Fascia, rakes and soffit",
  ceiling: "Ceiling",
  gutters: "Gutters and downspouts",
  walls: "Walls between the posts",
  cupola: "Cupola",
  electrical: "Electrical and accessories",
  own: "Your own items",
};
export const BOM_STEP_ORDER: readonly BomStep[] = ["slab", "footings", "ledger", "framing", "decking", "fascia", "stairs", "rails", "drainage", "roof-posts", "roof-frame", "roof-deck", "roofing", "trim", "ceiling", "gutters", "walls", "cupola", "electrical", "own"];

export interface BomLine {
  id: string;
  step: BomStep;
  kind: "lumber" | "boards" | "hardware" | "concrete" | "roofing" | "fixture" | "electrical";
  label: string;
  /** What is bought, in the unit a yard counts it in. */
  qty: number;
  unit: "pcs" | "ea" | "ft" | "bags" | "sq ft" | "sq";
  note?: string;
  /** The price-book row, how many of ITS units this line is, and a factor on its price. */
  rateKey: string;
  rateQty: number;
  factor: number;
  /** The client buys this one: listed, drawn, not priced (M3). */
  byClient?: boolean;
}

export interface DeckTakeoff {
  lines: BomLine[];
  /** The main deck's boards — null when there is no deck under the roof. */
  surface: DeckSurface | null;
  /** Feet of framing lumber bought, and of it, feet that must be ground-contact stock. */
  framingLf: number;
  groundContactLf: number;
  concreteBags: number;
  footings: number;
  /** The roof's figures, when there is one. */
  roofSquares: number;
  roofAreaSqFt: number;
  /** The stairs' risers in all, the rails' feet, the electrical's fixtures. */
  stairRisers: number;
  railLf: number;
  fixtures: number;
}

const ROLE_LABEL: Record<StickRole, string> = { joist: "joists", rim: "rim", ledger: "ledger", beam: "beams", post: "posts", blocking: "blocking", brace: "knee braces" };
const ROLE_STEP: Record<StickRole, BomStep> = { joist: "framing", rim: "framing", ledger: "ledger", beam: "framing", post: "footings", blocking: "framing", brace: "framing" };
const LEDGER_RATE: Record<LedgerFastener, string> = { lag: "hw.lag", bolt: "hw.bolt", "bolt-gap": "hw.bolt", ledgerlok: "hw.ledgerlok", sdws: "hw.sdws", anchor: "hw.anchor" };

const ROOF_ROLE_LABEL: Record<RoofRole, string> = {
  "roof-post": "roof posts",
  header: "headers",
  "roof-ledger": "roof ledger",
  rafter: "rafters",
  jack: "jack rafters",
  fly: "fly rafters",
  hip: "hip rafters",
  ridge: "ridge",
  king: "king posts",
  tie: "rafter ties",
  truss: "trusses",
  purlin: "purlins",
  slat: "slats",
  "roof-brace": "knee braces",
  ring: "ring beam",
  "tier-post": "tier posts",
  subfascia: "sub-fascia",
  "fascia-eave": "fascia",
  "fascia-rake": "rake boards",
  gutter: "gutter",
  downspout: "downspout",
  cupola: "cupola",
  kneewall: "wall plates",
  stud: "gablet studs",
  door: "screen door",
  fixture: "fixture",
};
const ROOF_ROLE_STEP: Partial<Record<RoofRole, BomStep>> = {
  "roof-post": "roof-posts",
  "roof-brace": "roof-posts",
  header: "roof-frame",
  "roof-ledger": "roof-frame",
  rafter: "roof-frame",
  jack: "roof-frame",
  fly: "roof-frame",
  hip: "roof-frame",
  ridge: "roof-frame",
  king: "roof-frame",
  tie: "roof-frame",
  truss: "roof-frame",
  purlin: "roof-frame",
  slat: "roof-frame",
  ring: "roof-frame",
  "tier-post": "roof-frame",
  stud: "roof-frame",
  subfascia: "trim",
  kneewall: "walls",
};
export const FIXTURE_RATE: Record<FixtureKind, string> = { "led-strip": "elec.ledStrip", "post-cap": "elec.postCap", "step-light": "elec.stepLight", "string-light": "elec.string", sconce: "elec.sconce", "ceiling-light": "elec.ceilingLight", chandelier: "elec.chandelier", fan: "elec.fan", outlet: "elec.gfci", heater: "elec.heater120", flood: "elec.flood" };

/** The shortest stock a stick comes out of. */
export function stockFor(lengthIn: number): number {
  return STOCK_LENGTHS_FT.find((s) => s * 12 >= lengthIn - 0.01) ?? STOCK_LENGTHS_FT[STOCK_LENGTHS_FT.length - 1];
}

/** A member longer than stock is bought in pieces, spliced: how many, and from what stock. */
export function piecesFor(lengthIn: number): { boards: number; stockFt: number } {
  const max = STOCK_LENGTHS_FT[STOCK_LENGTHS_FT.length - 1] * 12;
  const boards = Math.max(1, Math.ceil(lengthIn / max - 1e-9));
  return { boards, stockFt: stockFor(lengthIn / boards) };
}

/**
 * Short pieces cut from longer boards: the stock length that buys the least
 * lumber, the pieces laid into boards longest first (a saw kerf between).
 */
export function packPieces(lengthsIn: readonly number[], stocksFt: readonly number[]): { stockFt: number; boards: number } {
  const KERF = 0.125;
  const sorted = [...lengthsIn].sort((p, q) => q - p);
  let best: { stockFt: number; boards: number } | null = null;
  for (const s of stocksFt) {
    const room = s * 12;
    if (sorted.length && sorted[0] > room + 1e-6) continue;
    const bins: number[] = [];
    for (const len of sorted) {
      const i = bins.findIndex((left) => left >= len - 1e-6);
      if (i >= 0) bins[i] -= len + KERF;
      else bins.push(room - len - KERF);
    }
    if (!best || bins.length * s < best.boards * best.stockFt) best = { stockFt: s, boards: bins.length };
  }
  return best ?? { stockFt: stocksFt[stocksFt.length - 1], boards: lengthsIn.length };
}

/** Feet of lumber bought for a run of pieces, as `lumber()` would buy them. */
function lfOf(lengthsIn: readonly number[], stocks: readonly number[]): { stockFt: number; boards: number } {
  return packPieces(lengthsIn.map((l) => Math.ceil(l * 4 - 1e-9) / 4), stocks);
}

export function deckTakeoff(s: DeckStructure): DeckTakeoff {
  const design: DeckDesign = s.design;
  const roof = s.roof;
  const levels = structureLevels(s);
  const species = s.frame?.species ?? roof?.species;
  const lines: BomLine[] = [];
  const speciesFactor = species?.priceFactor ?? 1;
  const metal = design.extras.stainless ? STAINLESS_FACTOR : 1;
  const grade = (ground: boolean) => (species?.treated !== false ? (ground ? "ground-contact" : "above-ground") : "heartwood");
  let framingLf = 0;
  let groundContactLf = 0;

  /** A line, merged with an earlier one of the same id (two levels buy the same 2x10s). */
  const push = (l: BomLine) => {
    if (!(l.qty > 0)) return;
    const existing = lines.find((x) => x.id === l.id);
    if (existing) {
      existing.qty += l.qty;
      existing.rateQty += l.rateQty;
      return;
    }
    lines.push(l);
  };
  const lumber = (step: BomStep, roleLabel: string, nominal: string, stockFt: number, boards: number, ground: boolean, note?: string, idTag = roleLabel) => {
    if (!(boards > 0)) return;
    framingLf += boards * stockFt;
    if (ground) groundContactLf += boards * stockFt;
    const id = `lumber-${idTag.replace(/\s+/g, "-")}-${nominal.replace(/[^\w.]+/g, "")}-${stockFt}`;
    push({ id, step, kind: "lumber", label: `${nominal} × ${stockFt} ft — ${roleLabel}`, qty: boards, unit: "pcs", note: [grade(ground), note].filter(Boolean).join(" · "), rateKey: lumberKey(nominal), rateQty: boards * stockFt, factor: speciesFactor });
  };
  const hw = (id: string, step: BomStep, label: string, qty: number, rateKey: string, factor = 1, unit: BomLine["unit"] = "ea", note?: string) => {
    if (!(qty > 0)) return;
    push({ id, step, kind: "hardware", label, qty, unit, note, rateKey, rateQty: qty, factor: factor * metal });
  };

  let bags = 0;
  let footingCount = 0;

  /* ── The deck, level by level ──────────────────────────────────────── */
  for (const level of levels) {
    const frame: DeckFrame = level.frame;
    const surface = level.surface;
    const { hardware } = frame;
    const lower = level.id === "lower";
    // Long sticks: one board each. Short ones (posts, blocking, braces): several from a board. A curved rim is bought by the foot of ply.
    const byRole = (role: StickRole) => frame.sticks.filter((st) => st.role === role);
    for (const role of ["ledger", "beam", "joist", "rim"] as const) {
      for (const st of byRole(role)) {
        if (st.curved) continue;
        lumber(ROLE_STEP[role], ROLE_LABEL[role], st.nominal, stockFor(st.lengthIn), 1, st.ground, undefined, role);
      }
    }
    const curvedIn = byRole("rim").filter((st) => st.curved).reduce((a, st) => a + st.lengthIn, 0);
    if (curvedIn > 0) {
      const plies = 3;
      push({ id: "rim-curved", step: "framing", kind: "lumber", label: "Curved rim — 1/2-in. treated plywood plies, bent to the bow", qty: Math.ceil((curvedIn / 12) * plies), unit: "ft", note: `${plies} plies, glued and screwed, ${Math.round(curvedIn / 12)} ft of arc`, rateKey: "rim.curved", rateQty: Math.ceil((curvedIn / 12) * plies), factor: 1 });
    }
    const shorts = (role: StickRole, stocks: readonly number[]) => {
      const groups = new Map<string, { nominal: string; ground: boolean; lengths: number[] }>();
      for (const st of byRole(role) as Stick[]) {
        const g = groups.get(st.nominal) ?? { nominal: st.nominal, ground: st.ground, lengths: [] };
        g.lengths.push(Math.ceil(st.lengthIn * 4 - 1e-9) / 4);
        groups.set(st.nominal, g);
      }
      for (const g of groups.values()) {
        const pack = packPieces(g.lengths, stocks);
        const min = Math.min(...g.lengths);
        const max = Math.max(...g.lengths);
        lumber(ROLE_STEP[role], ROLE_LABEL[role], g.nominal, pack.stockFt, pack.boards, g.ground, `${g.lengths.length} cut ${max - min < 0.5 ? `at ${ftIn(max)}` : `from ${ftIn(min)} to ${ftIn(max)}`}`, role);
      }
    };
    shorts("post", [8, 10, 12, 16]);
    shorts("blocking", [8, 10, 12, 16]);
    shorts("brace", [8]);

    // Footings (the roof's posts on the deck have theirs here too).
    const poured = frame.posts.filter((p) => p.footing.type === "poured");
    const blocks = frame.posts.length - poured.length;
    const levelBags = poured.reduce((a, p) => a + p.footing.bags, 0);
    bags += levelBags;
    footingCount += frame.posts.length;
    const roofPosts = frame.posts.filter((p) => p.roof).length;
    if (levelBags > 0) push({ id: "concrete", step: "footings", kind: "concrete", label: "Concrete mix, 80-lb bags", qty: levelBags, unit: "bags", note: `${poured.length} footings${roofPosts ? `, ${roofPosts} of them under the roof's posts` : ""}${lower ? " (the lower level's among them)" : ""}`, rateKey: "conc.bag", rateQty: levelBags, factor: 1 });
    const tubes = new Map<number, number>();
    for (const p of poured) tubes.set(p.footing.pierIn, (tubes.get(p.footing.pierIn) ?? 0) + p.footing.tubeFt);
    for (const [diameter, ft] of [...tubes].sort((a, b) => a[0] - b[0])) {
      const qty = Math.ceil(ft - 1e-9);
      if (qty > 0) push({ id: `tube-${diameter}`, step: "footings", kind: "concrete", label: `Form tube, ${diameter} in.`, qty, unit: "ft", rateKey: "conc.tube", rateQty: qty, factor: tubeFactor(diameter) });
    }
    if (blocks > 0) push({ id: "pier-blocks", step: "footings", kind: "concrete", label: `Precast pier blocks, ${PIER_BLOCK.baseIn} in.`, qty: blocks, unit: "ea", rateKey: "conc.pierBlock", rateQty: blocks, factor: 1 });
    const postFactor = POST_HARDWARE_FACTOR[design.framing.post] ?? 1;
    const deckBases = poured.filter((p) => !p.roof).length;
    hw("post-bases", "footings", `Post bases, ${design.framing.post}`, deckBases, "hw.postBase", postFactor);
    hw("anchor-bolts", "footings", "Anchor bolts for the post bases", poured.length, "hw.anchorBolt");
    hw("post-caps", "footings", `Post caps, ${design.framing.post}`, hardware.postCaps, "hw.postCap", postFactor);

    // The ledger: its fasteners, the flashing over it, the membrane behind and above, the ties to the house.
    const ledgerFasteners = frame.ledgers.reduce((a, l) => a + l.fasteners, 0);
    if (frame.ledgers.length) {
      const f = design.ledger.fastener;
      const spacings = [...new Set(frame.ledgers.map((l) => l.spacingIn))].filter((sp) => sp > 0);
      hw("ledger-fasteners", "ledger", LEDGER_FASTENER_LABEL[f].replace(/^(.)/, (c) => c.toUpperCase()), ledgerFasteners, LEDGER_RATE[f], 1, "ea", spacings.length ? `every ${spacings.map((sp) => `${sp} in.`).join(" / ")}, two staggered rows` : undefined);
      const flashFt = Math.ceil(frame.ledgers.reduce((a, l) => a + l.lengthIn + 8, 0) / 12 - 1e-9);
      hw("flashing", "ledger", "Ledger cap flashing", flashFt, "hw.flashing", 1 / metal, "ft", "4 in. past each end");
      hw("membrane", "ledger", "Flashing membrane tape", flashFt * 2, "hw.membrane", 1 / metal, "ft", "behind the ledger and over its top");
      if (hardware.lateralTies === 4) hw("lateral-ties", "ledger", "Lateral ties to the house, 750 lb", 4, "hw.holddownSmall");
      else hw("lateral-ties", "ledger", "Lateral hold-downs to the house, 1,500 lb", hardware.lateralTies, "hw.holddown");
    }

    // Framing connectors.
    hw("hangers", "framing", `Joist hangers, ${frame.joistSize}`, hardware.hangers, "hw.hanger");
    hw("double-hangers", "framing", `Double joist hangers, ${frame.joistSize}`, hardware.doubleHangers, "hw.hangerDouble");
    hw("ties", "framing", "Hurricane ties, joist to beam", hardware.ties, "hw.tie");
    hw("connector-fasteners", "framing", "Connector nails and screws", hardware.hangers + 2 * hardware.doubleHangers + hardware.ties + hardware.postCaps + poured.length, "hw.connectorFasteners", 1, "ea", "one set per connector");
    hw("rim-screws", "framing", "Structural screws, rim to joists", hardware.rimScrews, "hw.structScrew", 1, "ea", "three in each joist end");
    hw("brace-lags", "framing", "1/2-in. lag screws for the knee braces", hardware.braces * 2, "hw.lag", 1, "ea", "one at each end of a brace");
    hw("framing-fasteners", "framing", "Framing nails and screws", Math.round(frame.areaSqFt), "fast.framing", 1, "sq ft");
    if (design.framing.joistTape) {
      const topsIn = frame.sticks.filter((st) => st.role === "joist" || st.role === "rim" || st.role === "ledger" || st.role === "beam").reduce((a, st) => a + st.lengthIn, 0);
      hw("joist-tape", "framing", "Joist tape", Math.ceil(topsIn / 12 / 10 - 1e-9) * 10, "hw.joistTape", 1 / metal, "ft", "joists, rim, ledger and beam tops");
    }

    // Boards and what holds them down.
    for (const st of surface.stock) {
      push({ id: `boards-${st.lengthFt}`, step: "decking", kind: "boards", label: `${surface.product.label} × ${st.lengthFt} ft`, qty: st.count, unit: "pcs", note: surface.border ? `${surface.border === 2 ? "double" : "single"} picture-frame border included` : surface.pattern !== "straight" ? `${surface.pattern}, bought by the foot` : undefined, rateKey: `deck.${surface.product.id}`, rateQty: st.count * st.lengthFt, factor: 1 });
    }
    hw("deck-fasteners", "decking", surface.fastening === "hidden" ? "Hidden clips and screws" : "Deck screws", Math.round(frame.areaSqFt), surface.fastening === "hidden" ? "fast.hidden" : "fast.screws", 1, "sq ft", surface.fastening === "hidden" ? `about ${surface.crossings} clips` : `about ${surface.crossings * 2} screws`);
    if (surface.fascia.on) {
      const nominal = surface.fascia.heightIn > 9.5 ? 12 : surface.fascia.heightIn > 7.5 ? 10 : 8;
      push({ id: "fascia", step: "fascia", kind: "boards", label: `Fascia, ${surface.fascia.kind === "composite" ? "composite" : "wood"} 1x${nominal} × 12 ft`, qty: surface.fascia.boards, unit: "pcs", note: `${Math.round(surface.fascia.lf)} ft of open edge`, rateKey: surface.fascia.kind === "composite" ? "fascia.composite" : "fascia.wood", rateQty: surface.fascia.boards * 12, factor: nominal / 10 });
    }
    if (design.extras.underDeckDrain && !lower) {
      push({ id: "under-deck-drain", step: "drainage", kind: "hardware", label: "Under-deck drainage: troughs, gutter and downspout", qty: Math.round(frame.areaSqFt), unit: "sq ft", note: "a dry room under the deck", rateKey: "trim.underDeckDrain", rateQty: Math.round(frame.areaSqFt), factor: 1 });
    }
  }

  /* ── The stairs ───────────────────────────────────────────────────── */
  let stairRisers = 0;
  const product = s.frame?.decking;
  for (const st of s.stairs) {
    stairRisers += st.risers;
    const tag = st.design.id;
    if (st.kind === "flight") {
      const stringers = lfOf(new Array<number>(st.stringers.count).fill(st.stringers.lengthIn), [10, 12, 14, 16, 18, 20]);
      lumber("stairs", "stair stringers", STRINGER_NOMINAL, stringers.stockFt, stringers.boards, true, `${st.stringers.count} cut, ${ftIn(st.stringers.lengthIn)} each, ${st.stringers.spacingIn} in. apart`, "stringer");
      hw("stringer-connectors", "stairs", "Stair stringer connectors", st.hardware.stringerConnectors, "hw.stringerConnector");
      lumber("stairs", "stair kicker", "2x4", stockFor(st.widthIn), 1, true, undefined, "kicker");
      if (st.pad) {
        push({ id: "stair-pad-concrete", step: "stairs", kind: "concrete", label: "Concrete mix for the stair pad, 80-lb bags", qty: st.pad.bags, unit: "bags", note: `${st.pad.widthIn} × ${st.pad.lengthIn} in., ${st.pad.thickIn} in. thick`, rateKey: "conc.bag", rateQty: st.pad.bags, factor: 1 });
        hw("stair-pad-anchors", "stairs", "Concrete anchors for the kicker", st.hardware.anchors, "hw.anchor");
      }
      if (st.pavers) push({ id: "stair-pavers", step: "stairs", kind: "concrete", label: "Pavers at the foot of the stairs", qty: st.pavers, unit: "ea", rateKey: "conc.paver", rateQty: st.pavers, factor: 1 });
      if (st.midSupport || st.landing) {
        const posts = st.members.filter((m) => m.role === "stair-post");
        const beams = st.members.filter((m) => m.role === "stair-beam" || m.role === "landing-frame");
        if (posts.length) {
          const pk = lfOf(posts.map((m) => m.lengthIn), [8, 10, 12]);
          lumber("stairs", st.landing ? "landing posts" : "stair support posts", posts[0].nominal, pk.stockFt, pk.boards, true, undefined, "stair-post");
        }
        if (beams.length) {
          const bk = lfOf(beams.map((m) => m.lengthIn), [8, 10, 12, 16]);
          lumber("stairs", st.landing ? "landing frame" : "stair beam", "2x8", bk.stockFt, bk.boards, true, undefined, "stair-beam");
        }
        hw("stair-post-bases", "stairs", "Post bases under the stair posts", st.hardware.postBases, "hw.postBase", POST_HARDWARE_FACTOR["4x4"]);
        const fts = st.footings.filter((f) => f.type === "poured");
        const fb = fts.reduce((a, f) => a + f.bags, 0);
        if (fb) push({ id: "stair-footing-concrete", step: "stairs", kind: "concrete", label: "Concrete mix for the stair footings, 80-lb bags", qty: fb, unit: "bags", rateKey: "conc.bag", rateQty: fb, factor: 1 });
      }
    } else {
      const frames = lfOf([st.boxFrameLf * 12], [8, 10, 12, 16]);
      void frames;
      const boards = Math.ceil((st.boxFrameLf * 1.05) / 12 - 1e-9);
      lumber("stairs", "box-step frames", BOX_FRAME_NOMINAL, 12, boards, true, `${st.treads} ${st.treads === 1 ? "level" : "levels"} wrapping ${st.design.wrapSides === 4 ? "four" : st.design.wrapSides === 3 ? "three" : "the front"} side${st.design.wrapSides === 1 ? "" : "s"}`, "box-frame");
      push({ id: "box-blocks", step: "stairs", kind: "concrete", label: "Precast blocks under the lowest step", qty: st.boxBlocks, unit: "ea", rateKey: "conc.pierBlock", rateQty: st.boxBlocks, factor: 1 });
      push({ id: "box-gravel", step: "stairs", kind: "concrete", label: "Gravel base under the steps", qty: st.gravelSqFt, unit: "sq ft", rateKey: "conc.gravel", rateQty: st.gravelSqFt, factor: 1 });
    }
    // Treads of the deck's boards, riser boards of fascia stock.
    if (product && st.treadBoardLf > 0) {
      const longest = Math.max(...product.lengthsFt);
      const treadBoards = Math.ceil((st.treadBoardLf * 1.1) / longest - 1e-9);
      push({ id: `tread-boards-${longest}`, step: "stairs", kind: "boards", label: `${product.label} × ${longest} ft — treads`, qty: treadBoards, unit: "pcs", note: `${st.treads + (st.landing ? 1 : 0)} treads, 10% waste`, rateKey: `deck.${product.id}`, rateQty: treadBoards * longest, factor: 1 });
    }
    if (st.riserBoardLf > 0) {
      const riserBoards = Math.ceil((st.riserBoardLf * 1.1) / 12 - 1e-9);
      push({ id: "riser-boards", step: "stairs", kind: "boards", label: `Riser boards, ${product && (product.family === "composite" || product.family === "pvc") ? "composite" : "wood"} 1x8 × 12 ft`, qty: riserBoards, unit: "pcs", rateKey: product && (product.family === "composite" || product.family === "pvc") ? "fascia.composite" : "fascia.wood", rateQty: riserBoards * 12, factor: 0.8 });
    }
    hw(`stair-screws-${tag}`, "stairs", "Tread and riser screws", Math.max(1, st.hardware.treadScrewsSqFt), "fast.screws", 1, "sq ft");
  }

  /* ── The rails ────────────────────────────────────────────────────── */
  const rails = s.rails;
  let railLf = 0;
  if (rails.on) {
    railLf = rails.totalLf;
    if (rails.system === "wood") {
      const postLen = rails.members.find((m) => m.role === "rail-post")?.lengthIn ?? 48;
      const posts = rails.posts + rails.stairPosts;
      const pk = lfOf(new Array<number>(posts).fill(postLen + 2), [8, 10, 12]);
      lumber("rails", "rail posts", RAIL_POST_NOMINAL, pk.stockFt, pk.boards, true, `${posts} posts, bolted through the rim`, "rail-post");
      const railRuns = Math.ceil(((rails.topRailLf + rails.bottomRailLf) * 1.05) / 12 - 1e-9);
      lumber("rails", "top and bottom rails", RAIL_TOP_NOMINAL, 12, railRuns, false, `${Math.round(rails.topRailLf)} ft of rail, two rails high`, "rail-run");
      if (rails.capLf) lumber("rails", "rail cap", RAIL_CAP_NOMINAL, 12, Math.ceil((rails.capLf * 1.05) / 12 - 1e-9), false, "a flat drink cap", "rail-cap");
      if (rails.balusters) {
        const balLen = rails.heightIn - 12;
        const bk = lfOf(new Array<number>(rails.balusters).fill(balLen), [8]);
        lumber("rails", "balusters", BALUSTER_NOMINAL, bk.stockFt, bk.boards, false, `${rails.balusters} at 5 in. on centre`, "baluster");
      }
      hw("rail-brackets", "rails", "Rail brackets", rails.hardware.railBrackets, "hw.railBracket");
      hw("rail-post-caps", "rails", "Post caps, decorative", rails.hardware.postCaps, "hw.postCapWood");
    } else if (rails.system === "kit") {
      push({ id: "rail-system", step: "rails", kind: "boards", label: `${rails.label} railing system, ${rails.heightIn} in., ${rails.infill}`, qty: Math.ceil(rails.totalLf), unit: "ft", note: `${rails.posts + rails.stairPosts} posts, ${rails.infill === "cable" ? `${rails.cableLf} ft of cable` : rails.infill === "glass" || rails.infill === "panel" ? `${rails.panels} panels` : `${rails.balusters} pickets`}`, rateKey: `rail.${rails.type}.material`, rateQty: Math.ceil(rails.totalLf), factor: 1 });
    } else if (rails.system === "custom") {
      push({ id: "rail-system", step: "rails", kind: "boards", label: "Custom railing — your price", qty: Math.ceil(rails.totalLf), unit: "ft", rateKey: "rail.custom.material", rateQty: Math.ceil(rails.totalLf), factor: 1 });
    }
    hw("rail-post-ties", "rails", "Rail post tension ties with bolts", rails.hardware.postTies, "hw.railPostTie");
  }

  /* ── The roof ─────────────────────────────────────────────────────── */
  let roofSquares = 0;
  let roofAreaSqFt = 0;
  if (roof) {
    const r = roof.roof;
    const pergola = roof.kind === "pergola";
    roofSquares = roof.squares;
    roofAreaSqFt = roof.roofAreaSqFt;
    const members = (role: RoofRole) => roof.members.filter((m) => m.role === role);
    const oneEach = (role: RoofRole, extraIn = 0) => {
      for (const m of members(role)) {
        if (m.nominal.startsWith("LVL")) {
          // An engineered beam: bought by the foot per inch of depth, one piece.
          const depth = Number(m.nominal.replace("LVL1.75x", ""));
          push({ id: `lvl-${role}-${depth}`, step: ROOF_ROLE_STEP[role] ?? "roof-frame", kind: "lumber", label: `LVL 1 3/4 × ${depth === 11.875 ? "11 7/8" : depth} in. — ${ROOF_ROLE_LABEL[role]}`, qty: 1, unit: "pcs", note: `${ftIn(m.lengthIn)} a ply, engineered`, rateKey: "lf.lvl", rateQty: (m.lengthIn / 12) * depth, factor: 1 });
          continue;
        }
        if (m.nominal === "2x12 (arch cut)") continue;
        const p = piecesFor(m.lengthIn + extraIn);
        lumber(ROOF_ROLE_STEP[role] ?? "roof-frame", ROOF_ROLE_LABEL[role], m.nominal, p.stockFt, p.boards, !!m.ground, p.boards > 1 ? "spliced" : undefined, role);
      }
    };
    const shortsOf = (role: RoofRole, stocks: readonly number[]) => {
      const groups = new Map<string, { nominal: string; ground: boolean; lengths: number[] }>();
      for (const m of members(role) as RoofMember[]) {
        if (m.nominal === "screen door" || m.nominal === "fan" || m.nominal === "light") continue;
        const g = groups.get(m.nominal) ?? { nominal: m.nominal, ground: !!m.ground, lengths: [] };
        g.lengths.push(Math.ceil(m.lengthIn * 4 - 1e-9) / 4);
        groups.set(m.nominal, g);
      }
      for (const g of groups.values()) {
        const pack = packPieces(g.lengths, stocks);
        const min = Math.min(...g.lengths);
        const max = Math.max(...g.lengths);
        lumber(ROOF_ROLE_STEP[role] ?? "roof-frame", ROOF_ROLE_LABEL[role], g.nominal, pack.stockFt, pack.boards, g.ground, `${g.lengths.length} cut ${max - min < 0.5 ? `at ${ftIn(max)}` : `from ${ftIn(min)} to ${ftIn(max)}`}`, role);
      }
    };

    // Posts, bases, caps, braces; footings or anchors under them.
    const postFactor = POST_HARDWARE_FACTOR[r.post] ?? 1;
    if (roof.floor === "deck") {
      for (const m of members("roof-post")) {
        const p = piecesFor(m.lengthIn);
        lumber("roof-posts", "roof posts", m.nominal, p.stockFt, p.boards, true, p.boards > 1 ? "spliced at the deck" : "footing to header, through the deck", "roof-post");
      }
      hw("roof-post-bases", "roof-posts", `Post bases, ${r.post}`, roof.posts.length, "hw.postBase", postFactor);
    } else {
      shortsOf("roof-post", [8, 10, 12, 16, 20]);
      // On concrete, new or already there, the posts sit on bases wedge-anchored into it; only a NEW slab gets the
      // slab line below (owner, 2026-11-06).
      const onSlab = roof.floor === "slab" || roof.floor === "existing";
      hw("roof-post-bases", "roof-posts", `Post bases, ${r.post}${onSlab ? `, anchored to the ${roof.floor === "existing" ? "existing " : ""}slab` : ""}`, roof.posts.length, "hw.postBase", postFactor);
      if (onSlab) hw("roof-anchors", "roof-posts", "Wedge anchors, two per base", roof.hardware.slabAnchors, "hw.wedgeAnchor");
      if (roof.floor === "ground") {
        const pours = roof.posts.map((p) => p.footing).filter((f): f is NonNullable<typeof f> => !!f && f.type === "poured");
        const rb = pours.reduce((a, f) => a + f.bags, 0);
        bags += rb;
        footingCount += roof.posts.length;
        if (rb > 0) push({ id: "roof-concrete", step: "roof-posts", kind: "concrete", label: "Concrete mix, 80-lb bags", qty: rb, unit: "bags", note: `${pours.length} footings under the posts`, rateKey: "conc.bag", rateQty: rb, factor: 1 });
        const tubes = new Map<number, number>();
        for (const f of pours) tubes.set(f.pierIn, (tubes.get(f.pierIn) ?? 0) + f.tubeFt);
        for (const [diameter, ft] of [...tubes].sort((a, b) => a[0] - b[0])) {
          const qty = Math.ceil(ft - 1e-9);
          if (qty > 0) push({ id: `roof-tube-${diameter}`, step: "roof-posts", kind: "concrete", label: `Form tube, ${diameter} in.`, qty, unit: "ft", rateKey: "conc.tube", rateQty: qty, factor: tubeFactor(diameter) });
        }
        hw("roof-anchor-bolts", "roof-posts", "Anchor bolts for the post bases", roof.posts.length, "hw.anchorBolt");
      }
    }
    hw("roof-post-caps", "roof-posts", `Post caps, ${r.post}, header to post`, roof.hardware.postCaps, "hw.postCap", postFactor);
    shortsOf("roof-brace", [8, 10]);
    hw("roof-brace-lags", "roof-posts", "1/2-in. lag screws for the knee braces", roof.hardware.braces * 2, "hw.lag");

    // The frame.
    oneEach("header");
    oneEach("roof-ledger");
    if (roof.ledger) hw("roof-ledger-screws", "roof-frame", "Structural screws, roof ledger to the house", roof.ledger.fasteners, "hw.roofScrew", 1, "ea", "two every 16 in.");
    oneEach("rafter", 4);
    if (roof.archRafters) {
      const archLf = members("rafter").filter((m) => m.nominal === "2x12 (arch cut)").reduce((a, m) => a + m.lengthIn, 0) / 12;
      push({ id: "arch-rafters", step: "roof-frame", kind: "lumber", label: "Arched rafters, cut from 2x12 stock", qty: Math.ceil(archLf), unit: "ft", note: `${roof.rafters.commons} rafters, two boards each`, rateKey: "lf.archRafter", rateQty: Math.ceil(archLf), factor: speciesFactor });
    }
    oneEach("jack", 4);
    oneEach("fly", 4);
    oneEach("hip", 6);
    oneEach("ridge");
    oneEach("tie");
    // Manufactured trusses (2026-10-11): bought by the truss, priced by the foot of span; the two gable ends carry studs
    // for the siding; permanent bracing per the truss drawings and BCSI-B3 — a row along the bottom chords and the webs,
    // diagonals at the ends.
    if (roof.trusses && roof.trusses.count > 0) {
      const T = roof.trusses;
      const spanFt = T.spanIn / 12;
      const commonsN = Math.max(0, T.count - T.gableEnds);
      push({ id: "trusses-common", step: "roof-frame", kind: "lumber", label: `Roof trusses, common — ${ftIn(T.spanIn)} span, ${r.pitch}:12, ${T.chord} chords`, qty: commonsN, unit: "ea", note: "designed and stamped by the truss maker (IRC R802.10) · 24 in. on center", rateKey: "lf.truss", rateQty: Math.round(commonsN * spanFt * 10) / 10, factor: 1 });
      push({ id: "trusses-gable", step: "roof-frame", kind: "lumber", label: `Roof trusses, gable end — ${ftIn(T.spanIn)} span`, qty: T.gableEnds, unit: "ea", note: "studs at 24 in. for the gable's siding", rateKey: "lf.truss", rateQty: Math.round(T.gableEnds * spanFt * 10) / 10, factor: 1.35 });
      const alongFt = Math.max(0, T.count - 1) * (T.spacingIn / 12);
      const braceLf = 3 * alongFt + 4 * Math.hypot(alongFt / 2, spanFt / 4);
      lumber("roof-frame", "truss bracing", "2x4", 12, Math.ceil(braceLf / 12), false, "permanent bracing per the truss drawings and BCSI-B3");
    }
    oneEach("ring");
    oneEach("slat");
    shortsOf("king", [8, 10]);
    shortsOf("tier-post", [8]);
    shortsOf("stud", [8]);
    shortsOf("purlin", [8, 10, 12, 16]);
    hw("hurricane-ties", "roof-frame", "Hurricane ties, rafter to header", roof.hardware.hurricaneTies, "hw.hurricaneTie");
    hw("rafter-hangers", "roof-frame", "Rafter hangers", roof.hardware.rafterHangers, "hw.rafterHanger", 1, "ea", roof.ridge?.kind === "beam" ? "at the ridge beam, the hips and the jacks" : "at the hips, the jacks and the ledger");
    hw("king-brackets", "roof-frame", "Post brackets at the king posts", roof.hardware.kingBrackets, "hw.kingBracket");
    hw("wall-hangers", "roof-frame", "Beam hangers at the house wall", roof.hardware.wallHangers, "hw.beamHanger");
    hw("ring-plate", "roof-frame", "Steel compression ring at the peak", roof.hardware.ringPlate, "hw.ringPlate");
    hw("gussets", "roof-frame", "Plywood gussets at the gambrel's break", roof.hardware.gussets, "hw.connectorFasteners", 4);
    // 2026-10-12: the hips push the corners out (a strap across every header joint); cross beams hang on the headers.
    hw("corner-straps", "roof-frame", "Tension straps across the header joints", roof.hardware.cornerStraps, "hw.cornerStrap", 1, "ea", `each rated for at least ${roof.ringTensionLb.toLocaleString("en-US")} lb — the hips push the corners out`);
    hw("cross-hangers", "roof-frame", "Beam hangers, cross beams into the headers", roof.hardware.crossHangers, "hw.beamHanger", 1, "ea", "over the posts under each cross beam's ends");
    hw("roof-connector-fasteners", "roof-frame", "Connector nails and screws", roof.hardware.hurricaneTies + roof.hardware.rafterHangers + roof.hardware.postCaps + roof.hardware.kingBrackets + roof.hardware.wallHangers + roof.hardware.cornerStraps + roof.hardware.crossHangers, "hw.connectorFasteners", 1, "ea", "one set per connector");
    hw("roof-framing-fasteners", "roof-frame", "Framing nails and screws", Math.round(pergola ? roof.footprintSqFt : roof.roofAreaSqFt), "fast.framing", 1, "sq ft");
    if (roof.louvers) push({ id: "louvers", step: "roof-frame", kind: "roofing", label: "Louvered slats, manual, with hardware", qty: roof.louvers.sqFt, unit: "sq ft", note: `${roof.louvers.blades} blades that turn`, rateKey: "trim.louverKit", rateQty: roof.louvers.sqFt, factor: 1 });

    if (!pergola) {
      const shingles = r.roofing === "arch-shingle" || r.roofing === "3tab-shingle" || r.roofing === "designer-shingle";
      const metalRoof = r.roofing === "metal-panel" || r.roofing === "standing-seam";
      if (roof.sheets > 0) push({ id: "sheathing", step: "roof-deck", kind: "roofing", label: "Roof sheathing, 1/2-in. 4x8 sheets", qty: roof.sheets, unit: "ea", note: `${Math.round(roof.roofAreaSqFt)} sq ft of roof, ${Math.round((roof.wasteFactor - 1) * 100)}% waste`, rateKey: "roof.sheathing", rateQty: roof.sheets, factor: 1 });
      if (roof.sheets > 0) push({ id: "underlayment", step: "roof-deck", kind: "roofing", label: "Synthetic underlayment", qty: roof.squares, unit: "sq", rateKey: "roof.underlayment", rateQty: roof.squares, factor: 1 });
      const dripPieces = Math.ceil((roof.eaveFt + roof.rakeFt) / 10 - 1e-9);
      hw("drip-edge", "roof-deck", "Drip edge, 10-ft pieces", dripPieces, "roof.dripEdge", 1 / metal, "ea", `${Math.round(roof.eaveFt)} ft of eave, ${Math.round(roof.rakeFt)} ft of rake`);
      // Where the roof meets the house (2026-11-07): named by what is there — apron (L) along a level top edge, step
      // flashing up a sloped one — and a kickout at the foot of each sloped one.
      if (roof.wallFt > 0) {
        const kinds = new Set(roof.wallFlashing.map((w) => w.kind));
        const what = kinds.has("apron") && kinds.has("step") ? "Apron (L) and step flashing" : kinds.has("step") ? "Step flashing" : "Apron (L) flashing";
        hw("wall-flashing", "roof-deck", `${what} where the roof meets the house, counter-flashed`, Math.ceil(roof.wallFt + 2), "roof.wallFlashing", 1 / metal, "ft");
      }
      const kickouts = roof.wallFlashing.filter((w) => w.kind === "kickout").length;
      if (kickouts) hw("kickout", "roof-deck", "Kickout flashing where an eave meets the wall", kickouts, "roof.kickout", 1 / metal, "ea", "turns the water into the gutter");
      if (!metalRoof) hw("roofing-nails", "roof-deck", "Roofing nails and cap nails", Math.ceil(roof.squares), "roof.nails", 1 / metal, "sq");
      if (shingles) {
        const key = r.roofing === "3tab-shingle" ? "roof.shingle.3tab" : r.roofing === "designer-shingle" ? "roof.shingle.designer" : "roof.shingle.arch";
        push({ id: "shingles", step: "roofing", kind: "roofing", label: ROOFING_LABEL[r.roofing], qty: roof.squares, unit: "sq", note: `${Math.ceil(roof.squares * 3)} bundles`, rateKey: key, rateQty: roof.squares, factor: 1 });
        hw("starter", "roofing", "Starter strip along the eaves", Math.ceil(roof.eaveFt), "roof.starter", 1 / metal, "ft");
        hw("hip-ridge", "roofing", "Hip and ridge cap", Math.ceil(roof.hipFt + roof.ridgeFt), "roof.hipRidge", 1 / metal, "ft");
      } else if (r.roofing === "cedar-shake") {
        push({ id: "shakes", step: "roofing", kind: "roofing", label: "Cedar shakes", qty: roof.squares, unit: "sq", rateKey: "roof.shake", rateQty: roof.squares, factor: 1 });
        hw("starter", "roofing", "Starter course along the eaves", Math.ceil(roof.eaveFt), "roof.starter", 1 / metal, "ft");
        hw("hip-ridge", "roofing", "Hip and ridge units", Math.ceil(roof.hipFt + roof.ridgeFt), "roof.hipRidge", 1 / metal, "ft");
      } else if (metalRoof) {
        const panelFt = roof.metalPanels.reduce((a, p) => a + p.count * p.lengthFt, 0);
        const seam = r.roofing === "standing-seam";
        push({ id: "metal-panels", step: "roofing", kind: "roofing", label: seam ? "Standing-seam metal panels" : "Metal roof panels, 36-in. cover", qty: seam ? Math.ceil(panelFt * (36 / 16)) : panelFt, unit: "ft", note: roof.metalPanels.map((p) => `${p.count} × ${p.lengthFt} ft`).join(", "), rateKey: seam ? "roof.metal.seam" : "roof.metal.panel", rateQty: seam ? Math.ceil(panelFt * (36 / 16)) : panelFt, factor: 1 });
        hw("metal-trim", "roofing", "Eave, rake, hip and ridge trim", Math.ceil(roof.eaveFt + roof.rakeFt + roof.hipFt + roof.ridgeFt), "roof.metal.trim", 1 / metal, "ft");
        hw("metal-screws", "roofing", "Metal roofing screws and closures", Math.ceil(roof.squares), "roof.metal.screws", 1 / metal, "sq");
      }
      oneEach("subfascia");
      const trimFt = Math.ceil((r.fascia.eave ? roof.eaveFt : 0) + (r.fascia.rake ? roof.rakeFt : 0));
      if (trimFt > 0) {
        const board = roof.rafters.size === "2x10" || roof.rafters.size === "2x12" ? "1x10" : "1x8";
        if (r.fascia.finish === "wood") hw("fascia-boards", "trim", `Fascia and rake boards, primed ${board}`, trimFt, "trim.fascia.wood", board === "1x10" ? 1.25 : 1, "ft");
        else if (r.fascia.finish === "pvc") hw("fascia-boards", "trim", `Fascia and rake boards, PVC ${board}`, trimFt, "trim.fascia.pvc", board === "1x10" ? 1.25 : 1, "ft");
        else hw("fascia-wrap", "trim", "Aluminum fascia wrap over the sub-fascia", trimFt, "trim.fascia.wrap", 1 / metal, "ft");
      }
      if (roof.soffitSqFt > 0) hw("soffit", "trim", "Vented soffit panels", Math.ceil(roof.soffitSqFt * 1.1), "trim.soffit", 1 / metal, "sq ft", `${roof.soffitSqFt} sq ft under the eaves`);
      if (roof.ceilingSqFt > 0) {
        const tg = r.ceiling === "tongue-groove";
        push({ id: "ceiling", step: "ceiling", kind: "boards", label: tg ? "Tongue-and-groove ceiling boards" : "Beadboard ceiling panels", qty: Math.ceil(roof.ceilingSqFt * 1.1), unit: "sq ft", note: "10% waste", rateKey: tg ? "trim.ceiling.tg" : "trim.ceiling.bead", rateQty: Math.ceil(roof.ceilingSqFt * 1.1), factor: 1 });
      }
      if (roof.gutters) {
        const g = roof.gutters;
        const key = g.kind === "k5" ? "gut.k5" : g.kind === "k6" ? "gut.k6" : g.kind === "half-round-alum" ? "gut.halfRoundAlum" : "gut.halfRoundCopper";
        const copper = g.kind === "half-round-copper";
        const label = g.kind === "k5" ? "5-in. K-style aluminum gutter" : g.kind === "k6" ? "6-in. K-style aluminum gutter" : copper ? "Half-round copper gutter" : "Half-round aluminum gutter";
        hw("gutter", "gutters", label, Math.ceil(g.lf), key, 1 / metal, "ft", `${g.runs === 1 ? "one run" : `${g.runs} runs`}${g.closed ? " around the roof" : ""}`);
        hw("downspouts", "gutters", copper ? "Round copper downspouts" : `${g.downspoutSize} downspouts`, g.downspoutFt, copper ? "gut.downspoutCopper" : g.downspoutSize === "2x3" ? "gut.downspout23" : "gut.downspout34", 1 / metal, "ft", `${g.downspouts} downspouts`);
        hw("gutter-hangers", "gutters", "Hidden hangers", g.hangers, "gut.hanger", copper ? 2.5 : 1);
        hw("gutter-caps", "gutters", "End caps", g.endCaps, "gut.endCap", copper ? 3 : 1);
        hw("gutter-corners", "gutters", "Mitred corners", g.corners, "gut.corner", copper ? 3 : 1);
        hw("gutter-outlets", "gutters", "Downspout outlets", g.downspouts, "gut.outlet", copper ? 3 : 1);
        hw("gutter-elbows", "gutters", "Downspout elbows", g.elbows, "gut.elbow", copper ? 3 : 1);
        hw("gutter-splash", "gutters", "Splash blocks or extensions", g.downspouts, "gut.splash");
        if (g.guardsLf > 0) hw("gutter-guards", "gutters", "Gutter guards", Math.ceil(g.guardsLf), "gut.guard", 1 / metal, "ft");
      }
      if (r.cupola) hw("cupola", "cupola", "Cupola, 30 in., louvers and roof", 1, "cupola.kit", 1 / metal, "ea", "set at the peak");
    }

    // Walls between the posts.
    if (roof.walls) {
      const w = roof.walls;
      shortsOf("kneewall", [8, 10, 12, 16]);
      if (w.fill === "screen") {
        push({ id: "screen-panels", step: "walls", kind: "boards", label: "Screen panels, framed", qty: w.sqFt, unit: "sq ft", note: `${w.segments.length} walls over a 36-in. kneewall`, rateKey: "trim.screen", rateQty: w.sqFt, factor: 1 });
        if (w.doors) push({ id: "screen-door", step: "walls", kind: "boards", label: "Screen door, hung", qty: w.doors, unit: "ea", rateKey: "trim.screenDoor", rateQty: w.doors, factor: 1 });
      } else push({ id: "wall-panels", step: "walls", kind: "boards", label: w.fill === "lattice" ? "Lattice panels, framed" : "Solid privacy panels, framed", qty: w.sqFt, unit: "sq ft", note: `${w.segments.length} walls, floor to header`, rateKey: w.fill === "lattice" ? "trim.lattice" : "trim.privacy", rateQty: w.sqFt, factor: 1 });
    }

    // A slab under it all.
    if (roof.slab) push({ id: "slab", step: "slab", kind: "concrete", label: "Concrete slab, 4 in., on a gravel base with mesh", qty: roof.slab.sqFt, unit: "sq ft", note: `about ${roof.slab.cuYd} cu yd`, rateKey: "conc.slab", rateQty: roof.slab.sqFt, factor: 1 });
  }

  /* ── The electrical ───────────────────────────────────────────────── */
  const el = s.electrical;
  let fixtureCount = 0;
  if (el.on) {
    const e = (id: string, label: string, qty: number, rateKey: string, unit: BomLine["unit"] = "ea", note?: string, byClient = false, kind: BomLine["kind"] = "electrical") => {
      if (!(qty > 0)) return;
      push({ id, step: "electrical", kind, label, qty, unit, note, rateKey, rateQty: byClient ? 0 : qty, factor: 1, byClient });
    };
    for (const c of el.circuits) e(`wire-${c.wire.replace("/", "")}`, `${c.wire} UF-B wire`, c.wireFt, c.wire === "10/2" ? "elec.wire102" : "elec.wire122", "ft", `${el.circuits.length} ${el.circuits.length === 1 ? "circuit" : "circuits"}, the home run from the panel included`);
    if (el.lv) {
      e("wire-lv", "16/2 low-voltage wire", el.lv.wireFt, "elec.wireLv", "ft");
      e("transformer", "Low-voltage transformer, 150 W, with timer", el.lv.transformers, "elec.transformer");
    }
    e("conduit", "3/4-in. PVC conduit and fittings", el.conduitFt, "elec.conduit", "ft", el.trenchFt ? `${el.trenchFt} ft underground to the structure` : "where the wire runs exposed");
    e("boxes", "Weatherproof boxes with in-use covers", el.boxes, "elec.box");
    e("gfci", "GFCI receptacles / protection", el.gfci, "elec.gfci");
    e("switches", "Weatherproof switches", el.switches, "elec.switch");
    e("dimmers", "Dimmers", el.dimmers, "elec.dimmer");
    e("fan-controls", "Fan speed controls", el.fanControls, "elec.fanControl");
    e("timers", "Timer or photocell", el.timers, "elec.timer");
    e("breakers-20", "20-A breakers", el.breakers20, "elec.breaker20");
    e("breakers-30", "30-A two-pole breakers", el.breakers30, "elec.breaker30");
    // The fixtures: grouped by kind and by who buys them.
    const groups = new Map<string, { kind: FixtureKind; byClient: boolean; qty: number; volts240: boolean; custom: { name: string; price: number } | null; name: string | null; firstId: string }>();
    for (const f of el.fixtures) {
      // A fixture of the contractor's own is its own line: its name, its price (2026-10-12). One the client buys keeps
      // its name when it has one, never a price.
      const mine = design.electrical.fixtures.find((x) => x.id === f.designId)?.custom ?? null;
      const own = f.supply === "we" ? mine : null;
      const name = mine?.name ?? null;
      const key = `${f.kind}:${f.supply}:${f.volts240 ? 240 : 120}${own ? `:${own.name}:${own.price}` : name ? `:${name}` : ""}`;
      const g = groups.get(key) ?? { kind: f.kind, byClient: f.supply === "client", qty: 0, volts240: f.volts240, custom: own, name, firstId: f.designId };
      g.qty += f.kind === "led-strip" ? Math.ceil(f.runFt) : f.kind === "string-light" ? Math.max(1, Math.ceil(f.runFt / 48)) : f.qty;
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      fixtureCount += g.kind === "led-strip" ? 1 : g.qty;
      const rate = g.custom ? `custom.fixture.${g.firstId}` : g.kind === "heater" && g.volts240 ? "elec.heater240" : FIXTURE_RATE[g.kind];
      const unit: BomLine["unit"] = g.kind === "led-strip" ? "ft" : "ea";
      const label = g.name ? g.name : `${FIXTURE_LABEL[g.kind]}${g.kind === "heater" ? (g.volts240 ? ", 4 kW 240 V" : ", 1.5 kW 120 V") : ""}`;
      e(`fixture-${key.replace(/[^a-z0-9]+/gi, "-")}`, g.byClient ? `${label} — supplied by the client` : label, g.qty, rate, unit, g.byClient ? "to be determined: drawn as a sample, not priced; its box, wire and hanging are" : undefined, g.byClient, "fixture");
    }
  }

  // PRODUCTS OF THE CONTRACTOR'S OWN (2026-10-12, owner: "always an option custom"): a list's custom product names and
  // prices that list's lines (the engine still frames and weighs it as what it works like), and items outside every
  // list go on as typed. Their rate keys point at the design: `custom.<slot>`, `own.<id>` (lib/deck/pricing).
  const cu = design.custom;
  for (const l of lines) {
    const own = (slot: CustomSlot, label?: string) => {
      l.rateKey = `custom.${slot}`;
      l.factor = 1;
      if (label !== undefined) l.label = label;
    };
    if (cu.decking && ((l.step === "decking" && l.id.startsWith("boards-")) || (l.step === "stairs" && l.id.startsWith("tread-boards-")))) own("decking");
    else if (cu.fastening && l.id === "deck-fasteners") own("fastening", cu.fastening.name);
    else if (cu.fascia && (l.id === "fascia" || l.id === "riser-boards")) own("fascia", `${cu.fascia.name} × 12 ft${l.id === "riser-boards" ? " — risers" : ""}`);
    else if (cu.roofing && roof && (l.id === "shingles" || l.id === "shakes" || l.id === "metal-panels")) {
      own("roofing", cu.roofing.name);
      l.qty = roof.squares;
      l.unit = "sq";
      l.rateQty = roof.squares;
      l.note = undefined;
    } else if (cu.ceiling && l.id === "ceiling") own("ceiling", cu.ceiling.name);
    else if (cu.roofFascia && (l.id === "fascia-boards" || l.id === "fascia-wrap")) own("roofFascia", cu.roofFascia.name);
    else if (cu.gutters && l.id === "gutter") own("gutters", cu.gutters.name);
    else if (cu.walls && (l.id === "screen-panels" || l.id === "wall-panels")) own("walls", cu.walls.name);
  }
  for (const it of design.extras.items) {
    if (it.qty > 0) lines.push({ id: `own-${it.id}`, step: "own", kind: "hardware", label: it.name, qty: it.qty, unit: it.unit, rateKey: `own.${it.id}`, rateQty: it.qty, factor: 1 });
  }

  lines.sort((a, b) => BOM_STEP_ORDER.indexOf(a.step) - BOM_STEP_ORDER.indexOf(b.step));
  return { lines, surface: s.surface, framingLf, groundContactLf, concreteBags: bags, footings: footingCount, roofSquares, roofAreaSqFt, stairRisers, railLf, fixtures: fixtureCount };
}
