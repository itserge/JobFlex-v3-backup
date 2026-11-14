// THE DECK'S PRICE (2026-10-04; roofs 2026-10-10; stairs, rails, levels and the electrical M3 2026-10-10) — pure.
//
// The material package (takeoff.ts) priced on the shop's book (rates.ts),
// and the crew's work priced by measure, folded into the lines a proposal
// carries — one line per step of the job, the way JobFlex proposals are
// written ("lines = the job's steps"):
//
//   footings and posts · ledger and flashing · framing · decking · fascia
//   · stairs · railing · the step between two levels · under-deck drainage
//   + the roof: posts · framing · roof deck · roofing · fascia and soffit ·
//     ceiling · gutters · walls between the posts · a slab · a cupola
//   + the electrical: wiring, boxes and circuits · fixtures we supply ·
//     fixtures the client brings (to be determined, $0)
//   + tear-out of an old deck
//
// Every line carries its MATERIAL and LABOR halves per unit, like the fence
// package (lib/fence/pricing.ts): the proposal can print both to the client,
// and the two halves always add up to the unit price. The package's total is
// the sum of its lines — the same sum the proposal will show, to the cent.
//
// These are SELLING prices (owner, 2026-10-01: an estimator's rates are what
// the shop charges; nothing is marked up again when it becomes a proposal).
//
// EXAMPLE PRICES. Until the shop types its own rates, the package stands on
// the book's example defaults; `exampleShare` says how much of the total
// does, and the studio shows it so nobody sends a client a placeholder.

import { footingDepthIn, type BuildOptions, type DeckFrame } from "./frame";
import { roofByHandWords, roofWords, type RoofFrame } from "./roof";
import { buildStructure, structureLevels, type DeckStructure } from "./structure";
import { deckTakeoff, type BomLine, type BomStep, type DeckTakeoff } from "./takeoff";
import { SKIRT_GAP_IN } from "./skirt";
import { BENCH_SEAT_IN, PLANTER_DEPTH_IN, builtInWords } from "./builtins";
import { isExampleSource, deckRate, type ResolvedRate } from "./rates";
import { railType, speciesWords } from "./catalog";
import { OC_POST } from "./ocLumber";
import { GUARD_REQUIRED_ABOVE_IN, LEDGER_FASTENER_LABEL, RISER_MAX_IN, ftIn } from "./codeTables";
import { codeWords } from "./stateCodes";
import { type CustomSlot, CEILING_LABEL, FASCIA_FINISH_LABEL, FIXTURE_LABEL, GUTTER_LABEL, PLACEMENT_LABEL, ROOFING_LABEL, ROOF_KIND_LABEL, WALL_FILL_LABEL, sizeWords, structureWords, type DeckDesign } from "./design";
import { RULE_RAFTER } from "./roofTables";
import { TERMITE_LABEL } from "./site";
import { railHeldWords, railNamed, railWords } from "./rails";
import { electricalWords } from "./electrical";
import type { MarketSnapshot } from "../fence/market";

export { buildStructure };

/** The shop's price book and the job's market. */
export type DeckPriceOptions = BuildOptions;

export interface DeckPackageLine {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unit: "sqft" | "ln ft" | "ea" | "lot";
  /** Per unit, material half. */
  materialCost: number;
  /** Per unit, labor half. */
  laborCost: number;
  /** material + labor, per unit. */
  unitPrice: number;
  /** Sales tax lands on materials; labor is untaxed in most states. */
  taxable: boolean;
  /** The client buys these fixtures: the line is in the proposal at $0 for the fixtures themselves. */
  tbd?: boolean;
}

/** A line of the material list with its price. */
export interface PricedBomLine extends BomLine {
  /** Per unit of `qty`. */
  unitPrice: number;
  cost: number;
  source: ResolvedRate["source"];
}

export interface DeckPackage {
  design: DeckDesign;
  structure: DeckStructure;
  /** The main deck's frame — null for a gazebo or a pergola on a slab or the ground. */
  frame: DeckFrame | null;
  /** The roof — null for a bare deck. */
  roof: RoofFrame | null;
  takeoff: DeckTakeoff;
  bom: PricedBomLine[];
  lines: DeckPackageLine[];
  subtotal: number;
  materialSubtotal: number;
  laborSubtotal: number;
  /** The deck's area (both levels), or the floor under a gazebo. */
  areaSqFt: number;
  /** subtotal ÷ area — the number a contractor checks a deck price by. */
  pricePerSqFt: number;
  /** The share of the subtotal that still stands on example prices, 0–1. */
  exampleShare: number;
  /** The share of the materials priced at the store's surveyed prices (lib/deck/storePrices), 0–1. */
  storeShare: number;
  /** Feet of railing and stair risers in the price (0 when none). */
  railFt: number;
  stairSteps: number;
  market?: MarketSnapshot;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** The proposal keeps a line's name to 200 characters and its description to 400 (lib/deck/convertSchema): cut at a word, never mid-figure. */
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);
const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

export function priceDeck(design: DeckDesign, opts: DeckPriceOptions = {}): DeckPackage {
  return priceStructure(buildStructure(design, opts), opts);
}

/** A bare deck's frame, priced (the QA harness's door). */
export function priceDeckFrame(frame: DeckFrame, opts: DeckPriceOptions = {}): DeckPackage {
  return priceDeck(frame.design, opts);
}

export function priceStructure(s: DeckStructure, opts: DeckPriceOptions = {}): DeckPackage {
  const { design, frame, roof } = s;
  const takeoff = deckTakeoff(s);
  // A product or an item of the contractor's own is priced as typed — their own number, like a price in their book.
  const ownRate = (key: string): ResolvedRate | null => {
    if (key.startsWith("custom.fixture.")) {
      const f = design.electrical.fixtures.find((x) => x.id === key.slice("custom.fixture.".length));
      return f?.custom ? { price: f.custom.price, source: "book" } : null;
    }
    if (key.startsWith("custom.")) {
      const c = design.custom[key.slice("custom.".length) as CustomSlot];
      return c ? { price: c.price, source: "book" } : null;
    }
    if (key.startsWith("own.")) {
      const it = design.extras.items.find((x) => x.id === key.slice("own.".length));
      return it ? { price: it.price, source: "book" } : null;
    }
    return null;
  };
  const rate = (key: string) => ownRate(key) ?? deckRate(key, opts.rates, opts.market);
  let exampleMoney = 0;

  const bom: PricedBomLine[] = takeoff.lines.map((l) => {
    const r = rate(l.rateKey);
    const cost = round2(l.rateQty * r.price * l.factor);
    return { ...l, unitPrice: l.qty > 0 ? round2(cost / l.qty) : 0, cost, source: l.byClient ? "book" : r.source };
  });
  const stepMaterial = (step: BomStep, filter: (l: PricedBomLine) => boolean = () => true) => bom.filter((l) => l.step === step && filter(l)).reduce((a, l) => a + l.cost, 0);
  const stepExample = (step: BomStep, filter: (l: PricedBomLine) => boolean = () => true) => bom.filter((l) => l.step === step && filter(l) && isExampleSource(l.source)).reduce((a, l) => a + l.cost, 0);

  const lines: DeckPackageLine[] = [];
  /** One line: the totals for its step, spread over its quantity, the halves adding up to the cent. */
  const line = (l: { id: string; name: string; description?: string; quantity: number; unit: DeckPackageLine["unit"]; material: number; labor: number; exampleMaterial: number; exampleLabor: number; tbd?: boolean }) => {
    if (!(l.quantity > 0) || (!(l.material + l.labor > 0) && !l.tbd)) return;
    const unitPrice = round2((l.material + l.labor) / l.quantity);
    const materialCost = Math.min(unitPrice, round2(l.material / l.quantity));
    lines.push({ id: l.id, name: clip(l.name, 200), description: l.description === undefined ? undefined : clip(l.description, 400), quantity: l.quantity, unit: l.unit, materialCost, laborCost: round2(unitPrice - materialCost), unitPrice, taxable: l.material > 0, tbd: l.tbd });
    exampleMoney += l.exampleMaterial + l.exampleLabor;
  };
  /** Labor by measure: a rate times a quantity, and how much of it is still an example. */
  const work = (key: string, qty: number) => {
    const r = rate(key);
    const amount = r.price * qty;
    return { amount, example: isExampleSource(r.source) ? amount : 0 };
  };
  const none = { amount: 0, example: 0 };
  const sum = (...ws: Array<{ amount: number; example: number }>) => ({ amount: ws.reduce((a, w) => a + w.amount, 0), example: ws.reduce((a, w) => a + w.example, 0) });

  const levels = structureLevels(s);
  const deckArea = levels.reduce((a, l) => a + Math.round(l.frame.areaSqFt * 10) / 10, 0);
  const area = frame ? deckArea : roof ? Math.round((roof.slab?.sqFt ?? roof.ringAreaSqFt) * 10) / 10 : 0;
  const twoLevels = levels.length > 1;

  /* ── The slab under a gazebo or a pergola ─────────────────────────── */
  if (roof?.slab) {
    const w = work("labor.slab", roof.slab.sqFt);
    line({ id: "deck-slab", name: `Concrete slab, 4 in. — ${roof.slab.sqFt} sq ft`, description: `Gravel base, wire mesh, broom finish, about ${roof.slab.cuYd} cu yd; a foot past the posts on every side`, quantity: roof.slab.sqFt, unit: "sqft", material: stepMaterial("slab"), labor: w.amount, exampleMaterial: stepExample("slab"), exampleLabor: w.example });
  }

  /* ── The deck, both levels in one set of lines ────────────────────── */
  if (frame && s.surface) {
    const allPosts = levels.flatMap((l) => l.frame.posts);
    const deckPosts = allPosts.filter((p) => !p.roof);
    const roofPostsOnDeck = allPosts.filter((p) => p.roof).length;
    const posts = allPosts.length;
    const poured = allPosts.filter((p) => p.footing.type === "poured").length;
    const first = deckPosts[0] ?? allPosts[0];

    // Footings and posts.
    {
      const w1 = work("labor.footing", poured);
      const w2 = work("labor.pierBlock", posts - poured);
      const pads = [...new Set(allPosts.filter((p) => p.footing.type === "poured").map((p) => p.footing.padIn))].sort((a, b) => a - b);
      const description = poured
        ? `Poured concrete, ${pads.length > 1 ? `${pads[0]}–${pads[pads.length - 1]}` : pads[0]} in. across and ${footingDepthIn(design)} in. deep; ${first && first.heightIn >= 1 ? `${design.framing.post === OC_POST ? "OC Lumber posts (three 2x6 boards each)" : `${design.framing.post} posts`} on stand-off bases` : "beams set on post bases"}${roofPostsOnDeck ? `; ${plural(roofPostsOnDeck, "footing")} under the roof's posts` : ""}${twoLevels ? "; the lower level's footings among them" : ""}${s.gradePct >= 2 ? `; the ground falls ${s.gradePct}% under the deck, so the downhill posts are longer` : ""}`
        : `Precast pier blocks under ${design.framing.post === OC_POST ? "OC Lumber posts" : `${design.framing.post} posts`}`;
      line({ id: "deck-footings", name: `Footings and posts — ${plural(posts, "footing")}`, description, quantity: posts, unit: "ea", material: stepMaterial("footings"), labor: w1.amount + w2.amount, exampleMaterial: stepExample("footings"), exampleLabor: w1.example + w2.example });
    }

    // Ledger and flashing.
    const ledgerFt = Math.round((frame.ledgers.reduce((a, l) => a + l.lengthIn, 0) / 12) * 10) / 10;
    if (ledgerFt > 0) {
      const w = work("labor.ledger", ledgerFt);
      const spacing = Math.min(...frame.ledgers.map((l) => l.spacingIn).filter((sp) => sp > 0));
      line({ id: "deck-ledger", name: "Ledger on the house, flashed", description: `${LEDGER_FASTENER_LABEL[design.ledger.fastener]}${Number.isFinite(spacing) ? ` every ${spacing} in., two staggered rows` : ""}; cap flashing and membrane; ${frame.hardware.lateralTies} lateral ties`, quantity: ledgerFt, unit: "ln ft", material: stepMaterial("ledger"), labor: w.amount, exampleMaterial: stepExample("ledger"), exampleLabor: w.example });
    }

    // Framing.
    {
      const w = work("labor.framing", deckArea);
      const braces = work("labor.brace", levels.reduce((a, l) => a + l.frame.hardware.braces, 0));
      const beamSizes = [...new Set(levels.flatMap((l) => l.frame.beams.map((b) => b.spec.size)))];
      const front = design.shape.kind === "rect" ? design.shape.front : undefined;
      line({
        id: "deck-framing",
        name: `Framing — ${speciesWords(frame.species)}${s.lower?.place === "under" ? ", a double deck" : twoLevels ? ", two levels" : ""}`,
        description: `${frame.joistSize} joists ${frame.spacingIn} in. on center; ${beamSizes.join(" and ")} ${frame.beamStyle === "flush" ? "flush " : ""}${beamSizes.length === 1 && levels.length === 1 && frame.beams.length === 1 ? "beam" : "beams"}${design.framing.doubleRim ? "; doubled rim and outside joists" : ""}${design.framing.joistTape ? "; joist tape" : ""}${front?.kind === "curve" ? `; the front bowed out ${front.bulgeFt} ft on a laminated rim, joists cut to the arc` : front?.kind === "clipped" ? `; corners clipped ${front.clipFt} ft` : ""}${twoLevels ? `; the lower level ${design.lower.widthFt} × ${design.lower.depthFt} ft, ${ftIn(design.lower.dropIn)} down` : ""}; hangers, ties and blocking`,
        quantity: deckArea,
        unit: "sqft",
        material: stepMaterial("framing"),
        labor: w.amount + braces.amount,
        exampleMaterial: stepExample("framing"),
        exampleLabor: w.example + braces.example,
      });
    }

    // Decking.
    {
      const surface = s.surface;
      const w = work(`labor.decking.${frame.decking.labor}`, deckArea);
      const d = surface.pattern !== "straight" ? work("labor.diagonal", deckArea * (surface.pattern === "herringbone" ? 1.3 : 1)) : none;
      line({
        id: "deck-decking",
        name: `Decking — ${frame.decking.label}`,
        description: `${surface.pattern === "straight" ? "Laid square to the joists" : surface.pattern === "diagonal" ? "Laid on the diagonal" : "Laid in a herringbone"}${surface.border ? `, ${surface.border === 2 ? "a double" : "a"} picture-frame border${surface.product.border ? ` in ${surface.product.border.name}` : ""}` : ""}, ${surface.fastening === "hidden" ? "hidden fasteners" : "deck screws"}`,
        quantity: deckArea,
        unit: "sqft",
        material: stepMaterial("decking"),
        labor: w.amount + d.amount,
        exampleMaterial: stepExample("decking"),
        exampleLabor: w.example + d.example,
      });
    }

    // Fascia. (The skirting's panels are bought with the fascia and priced on their own line.)
    const isSkirt = (l: PricedBomLine) => l.id.includes("skirt");
    const notSkirt = (l: PricedBomLine) => !isSkirt(l);
    const fasciaFt = levels.reduce((a, l) => a + l.surface.fascia.lf, 0);
    if (fasciaFt > 0) {
      const w = work("labor.fascia", fasciaFt);
      line({ id: "deck-fascia", name: "Fascia on the open edges", quantity: Math.round(fasciaFt * 10) / 10, unit: "ln ft", material: stepMaterial("fascia", notSkirt), labor: w.amount, exampleMaterial: stepExample("fascia", notSkirt), exampleLabor: w.example });
    }

    // Built-in benches and planter boxes (2026-11-14; lib/deck/builtins): a line for the benches, a line for the boxes.
    {
      const benches = s.builtIns.filter((b) => b.built && b.kind !== "planter");
      const planters = s.builtIns.filter((b) => b.built && b.kind === "planter");
      const ftOf = (list: typeof benches) => Math.round((list.reduce((a, b) => a + b.lengthIn, 0) / 12) * 2) / 2;
      if (benches.length) {
        const backs = benches.filter((b) => b.kind === "bench-back");
        const isBench = (l: PricedBomLine) => l.id.includes("bench");
        const w = sum(work("labor.bench", ftOf(benches)), backs.length ? work("labor.benchBack", ftOf(backs)) : none);
        line({
          id: "deck-benches",
          name: `${benches.length === 1 ? "Built-in bench" : `${benches.length} built-in benches`}${backs.length === benches.length ? " with a back" : backs.length ? `, ${backs.length} with a back` : ""}`,
          description: `${benches.map((b) => builtInWords(b).replace(/^an? /, "")).join("; ")} — the seat ${BENCH_SEAT_IN} in. above the deck in the deck's own boards, on 4x4 legs no more than 4 ft apart, a fascia apron under its edge, blocking between the joists under every support`,
          quantity: ftOf(benches),
          unit: "ln ft",
          material: stepMaterial("builtins", isBench),
          labor: w.amount,
          exampleMaterial: stepExample("builtins", isBench),
          exampleLabor: w.example,
        });
      }
      if (planters.length) {
        const isPlanter = (l: PricedBomLine) => l.id.includes("planter");
        const w = work("labor.planter", ftOf(planters));
        line({
          id: "deck-planters",
          name: planters.length === 1 ? "Planter box" : `${planters.length} planter boxes`,
          description: `${planters.map((b) => builtInWords(b).replace(/^an? /, "")).join("; ")} — ${PLANTER_DEPTH_IN} in. deep, three boards high in the deck's own boards on a treated frame, a cap board round the rim; lined, with drain holes; soil and plants by the owner`,
          quantity: ftOf(planters),
          unit: "ln ft",
          material: stepMaterial("builtins", isPlanter),
          labor: w.amount,
          exampleMaterial: stepExample("builtins", isPlanter),
          exampleLabor: w.example,
        });
      }
    }

    // Skirting under the deck (2026-11-14; lib/deck/skirt): its panels or boards and the frame behind them, hung like
    // the framed panels between a roof's posts.
    if (s.skirt) {
      const sk = s.skirt;
      const w = work("labor.walls", sk.sqFt);
      line({
        id: "deck-skirt",
        name: `Skirting under the deck — ${sk.kind === "lattice" ? "lattice in a border" : "the deck's boards laid level"}`,
        description: `${Math.round(sk.lf)} ft of open edge, up to ${sk.heightIn} in. high, on a treated 2x4 frame hung under the rim; a hand clear of the ground${sk.kind === "boards" ? `, ${SKIRT_GAP_IN}-in. gaps between the boards for air` : ""}; one bay on hinges, to get under the deck`,
        quantity: Math.max(1, Math.round(sk.sqFt)),
        unit: "sqft",
        material: stepMaterial("fascia", isSkirt),
        labor: w.amount,
        exampleMaterial: stepExample("fascia", isSkirt),
        exampleLabor: w.example,
      });
    }

    // The step between the levels (a low drop is a step the lower deck itself makes; the trim and the riser are the work).
    if (s.lower && s.stepDown && s.stepDown.dropIn <= RISER_MAX_IN) {
      const ft = Math.round((s.stepDown.lengthIn / 12) * 10) / 10;
      const w = work("labor.stepDown", ft);
      line({ id: "deck-step", name: "Step down to the lower level", description: `${ftIn(s.stepDown.dropIn)} down, ${ft} ft long: riser board and nosing`, quantity: ft, unit: "ln ft", material: 0, labor: w.amount, exampleMaterial: 0, exampleLabor: w.example });
    }

    // Under-deck drainage.
    if (design.extras.underDeckDrain) {
      const w = work("labor.underDeckDrain", Math.round(frame.areaSqFt));
      line({ id: "deck-drainage", name: "Under-deck drainage", description: "Troughs between the joists to a gutter and downspout: a dry room under the deck", quantity: Math.round(frame.areaSqFt), unit: "sqft", material: stepMaterial("drainage"), labor: w.amount, exampleMaterial: stepExample("drainage"), exampleLabor: w.example });
    }
  }

  /* ── Stairs ──────────────────────────────────────────────────────── */
  const stairSteps = s.stairs.reduce((a, st) => a + st.risers, 0);
  if (stairSteps > 0) {
    const flights = s.stairs.filter((st) => st.kind === "flight");
    const boxes = s.stairs.filter((st) => st.kind === "box");
    const w = sum(
      ...flights.map((st) => work("stairs.labor", st.risers * (st.widthIn / 12))),
      // (Wide steps on stringers are built as a stair as wide as the edge they follow: so many risers, so many feet.)
      ...boxes.map((st) => (st.wide ? work("stairs.labor", st.risers * (st.wide.lengthIn / 12)) : work("stairs.boxLabor", st.boxFrameLf))),
      work("stairs.pad", s.stairs.filter((st) => st.pad).length),
      // (Every landing is framed and posted; a stair with a beam under a long flight and no landing counts once, as it did.)
      work("stairs.landing", s.stairs.reduce((a, st) => a + (st.landings.length || (st.midSupport ? 1 : 0)), 0)),
    );
    const words = s.stairs.map((st) => (st.kind === "box" ? `${st.wide ? "wide steps on stringers" : "box steps"} wrapping ${st.design.wrapSides === 4 ? "four sides" : st.design.wrapSides === 3 ? "three sides" : "the front"} (${plural(st.risers, "riser")})` : `a ${st.widthIn / 12}-ft flight of ${plural(st.risers, "riser")} down the ${st.design.side}${st.lands === "lower-deck" ? " to the lower level" : st.design.landing === "pad" ? " onto a new pad" : st.design.landing === "patio" ? " onto the patio" : " onto pavers"}${st.landings.length > 1 ? `, ${st.landings.length} landings on the way down${st.landings.some((l) => l.turn !== "straight") ? ", turning" : ""}` : st.landing ? (st.landings[0]?.turn !== "straight" ? ", a landing and a turn midway" : ", a landing midway") : st.midSupport ? ", a beam midway" : ""}${st.rail.sides ? `, ${st.rail.sides === 2 ? "rails both sides" : "a handrail"}` : ""}`));
    line({ id: "deck-stairs", name: `Stairs — ${plural(s.stairs.length, "stair")}, ${plural(stairSteps, "riser")}`, description: `${words.length > 3 ? `${words.slice(0, 3).join("; ")}; and ${plural(words.length - 3, "more stair")}` : words.join("; ")}. ${flights.length ? `2x12 stringers ${flights[0].stringers.spacingIn} in. apart, treads of the deck's boards, riser boards` : "2x6 box frames on blocks over gravel, treads of the deck's boards"}`, quantity: stairSteps, unit: "ea", material: stepMaterial("stairs"), labor: w.amount, exampleMaterial: stepExample("stairs"), exampleLabor: w.example });
  }

  /* ── Railing ─────────────────────────────────────────────────────── */
  const rails = s.rails;
  const railFt = rails.on ? rails.totalLf : 0;
  if (railFt > 0) {
    const t = railType(design.rail.type);
    if (rails.system === "custom") {
      const each = design.rail.customPerFt;
      line({ id: "deck-rail", name: `Railing — ${design.rail.customName || "custom"}`, description: `${railWords(rails)}; your installed price by the foot`, quantity: railFt, unit: "ln ft", material: each * railFt * 0.6, labor: each * railFt * 0.4, exampleMaterial: 0, exampleLabor: 0 });
    } else {
      const l = work(`rail.${t.id}.labor`, railFt);
      line({ id: "deck-rail", name: `Railing — ${railNamed(rails).toLowerCase()}, ${rails.heightIn} in.`, description: `${plural(rails.posts + rails.stairPosts, "post")} ${railHeldWords(rails)}; ${rails.infill === "balusters" ? (rails.baluster === "metal" && rails.type !== "aluminum" ? `${rails.balusters} round black metal balusters at 4½ in.` : `${rails.balusters} ${rails.system === "wood" ? "2x2 balusters" : "pickets"} at ${rails.baluster === "metal" ? "4½" : "5"} in.`) : rails.infill === "cable" ? `${rails.cableLf} ft of cable` : rails.infill === "glass" ? `${rails.panels} glass panels` : rails.infill === "panel" ? `${rails.panels} panels` : rails.infill === "mesh" ? `${rails.meshPanels} welded wire mesh panels` : "horizontal rails"}${rails.capLf ? "; a flat 2x6 cap" : ""}${rails.drinkLf ? "; a deck board on top as a drink rail" : ""}${rails.stairLf ? `; ${Math.round(rails.stairLf)} ft on the stairs` : ""}`, quantity: railFt, unit: "ln ft", material: stepMaterial("rails"), labor: l.amount, exampleMaterial: stepExample("rails"), exampleLabor: l.example });
    }
  }

  /* ── The roof ─────────────────────────────────────────────────────── */
  if (roof) {
    const r = roof.roof;
    const pergola = roof.kind === "pergola";
    const kindName = roof.kind === "double-tier" ? "double-tier" : roof.kind === "dutch-gable" ? "Dutch gable" : roof.kind;
    const hipRoof = roof.kind === "hip" || roof.kind === "pyramid" || roof.kind === "double-tier" || roof.kind === "dutch-gable";

    // Posts.
    {
      const n = roof.posts.length;
      const w = sum(work("labor.roofPost", n), work("labor.brace", roof.hardware.braces), roof.floor === "ground" ? work("labor.footing", n) : none);
      const where = roof.floor === "deck" ? "from their own footings up through the deck" : roof.floor === "slab" ? "on bases anchored to the slab" : roof.floor === "existing" ? "on bases wedge-anchored to the existing slab (no concrete in this price)" : `on poured footings ${footingDepthIn(design.floor === "ground" ? { ...design, placement: roof.attach === "wall" ? "attached" : "detached" } : design)} in. deep`;
      line({ id: "roof-posts", name: `${pergola ? "Pergola" : "Roof"} posts — ${plural(n, `${r.post} post`)}`, description: `${ftIn(r.eaveHeightIn)} to the headers, ${where}${roof.hardware.braces ? `; ${plural(roof.hardware.braces, "knee brace")}` : ""}`, quantity: n, unit: "ea", material: stepMaterial("roof-posts"), labor: w.amount, exampleMaterial: stepExample("roof-posts"), exampleLabor: w.example });
    }

    // Framing.
    {
      const qty = pergola ? Math.round(roof.footprintSqFt) : Math.round(roof.roofAreaSqFt);
      const w = sum(work("labor.roofFrame", qty), hipRoof ? work("labor.hipExtra", qty) : none, roof.ledger ? work("labor.roofLedger", roof.ledger.lengthIn / 12) : none, pergola && !roof.louvers ? work("labor.slats", qty) : none);
      const headers = [...new Set(roof.headers.map((h) => h.spec.size))].join(" and ");
      const ridgeWords = roof.trusses ? `${plural(roof.trusses.count, "manufactured truss", "manufactured trusses")} spanning ${ftIn(roof.trusses.spanIn)}, no ridge beam` : roof.ridge ? (roof.ridge.kind === "beam" ? `${roof.ridge.spec?.size ?? roof.ridge.nominal} ridge beam on ${plural(roof.kingPosts, "king post")}${roof.attach === "wall" ? " and the house" : ""}` : `${roof.ridge.nominal} ridge board${roof.ties ? ` with ${plural(roof.ties, "rafter tie")}` : ""}`) : roof.hips.count ? `${roof.hips.count} ${roof.hips.nominal} hips to the peak` : "";
      const description = pergola
        ? `${roof.archRafters ? "Arched " : ""}${roof.rafters.size} rafters ${roof.rafters.spacingIn} in. on center on ${headers} headers; ${roof.louvers ? "louvered slats that turn" : `${r.slats.size} slats ${r.slats.spacingIn} in. apart`}; ${ftIn(r.overhangIn)} overhang`
        : `${roof.trusses ? "Manufactured trusses 24 in. on center" : `${roof.rafters.size} rafters ${roof.rafters.spacingIn} in. on center`}${roof.hips.count ? `, ${roof.hips.nominal} hips` : ""}; ${headers} headers on the posts${roof.engineered ? " (engineered LVL where no sawn beam reaches)" : ""}${roof.ledger ? `; ${roof.ledger.nominal} ledger on the house` : ""}${ridgeWords ? `; ${ridgeWords}` : ""}${roof.breakTies ? `; ${plural(roof.breakTies, "tie")} at the gambrel's break` : ""}${roof.gablets ? "; two gablets" : ""}; ${ftIn(r.overhangIn)} overhang; hurricane ties and hangers`;
      line({ id: "roof-frame", name: pergola ? `Pergola framing — ${plural(roof.rafters.count, "rafter")}${roof.slats ? `, ${plural(roof.slats.count, "slat")}` : roof.louvers ? ", louvers" : ""}` : `Roof framing — ${kindName} ${r.pitch}:12`, description, quantity: qty, unit: "sqft", material: stepMaterial("roof-frame"), labor: w.amount, exampleMaterial: stepExample("roof-frame"), exampleLabor: w.example });
    }

    if (!pergola) {
      const areaR = Math.round(roof.roofAreaSqFt);
      if (stepMaterial("roof-deck") > 0) {
        const w = roof.sheets > 0 ? work("labor.sheathing", areaR) : none;
        line({ id: "roof-deck", name: roof.sheets > 0 ? "Roof deck — sheathing, underlayment, drip edge" : "Roof deck — drip edge and flashing", description: roof.sheets > 0 ? `${plural(roof.sheets, "sheet")} of 1/2-in. sheathing, synthetic underlayment, drip edge on ${Math.round(roof.eaveFt + roof.rakeFt)} ft of edge${roof.wallFt ? (roof.wallFlashing.some((wf) => wf.kind === "kickout") ? ", step-flashed to the house with kickouts" : ", flashed to the house") : roof.houseGap ? ", clear of the house for the back gutter" : ""}` : `Metal on purlins; drip edge on ${Math.round(roof.eaveFt + roof.rakeFt)} ft of edge${roof.wallFt ? (roof.wallFlashing.some((wf) => wf.kind === "kickout") ? ", step-flashed to the house with kickouts" : ", flashed to the house") : roof.houseGap ? ", clear of the house for the back gutter" : ""}`, quantity: areaR, unit: "sqft", material: stepMaterial("roof-deck"), labor: w.amount, exampleMaterial: stepExample("roof-deck"), exampleLabor: w.example });
      }
      {
        const metalRoof = r.roofing === "metal-panel" || r.roofing === "standing-seam";
        const w = metalRoof ? work("labor.metal", areaR) : work("labor.shingles", roof.squares);
        line({ id: "roofing", name: `Roofing — ${design.custom.roofing?.name ?? ROOFING_LABEL[r.roofing].toLowerCase()}`, description: `${roof.squares} squares with waste; ${Math.round(roof.hipFt + roof.ridgeFt)} ft of hip and ridge${metalRoof ? "; eave, rake and ridge trim" : "; starter strip and cap"}`, quantity: areaR, unit: "sqft", material: stepMaterial("roofing"), labor: w.amount, exampleMaterial: stepExample("roofing"), exampleLabor: w.example });
      }
      {
        const trimFt = Math.round(((r.fascia.eave ? roof.eaveFt : 0) + (r.fascia.rake ? roof.rakeFt : 0)) * 10) / 10;
        const w = sum(work("labor.trim", trimFt), roof.soffitSqFt ? work("labor.soffit", roof.soffitSqFt) : none);
        if (trimFt > 0 || roof.soffitSqFt > 0) {
          const parts = [r.fascia.eave ? `${Math.round(roof.eaveFt)} ft of eave` : null, r.fascia.rake && roof.rakeFt ? `${Math.round(roof.rakeFt)} ft of rake` : null].filter(Boolean).join(", ");
          line({ id: "roof-trim", name: `Fascia${roof.soffitSqFt ? " and soffit" : ""} — ${design.custom.roofFascia?.name ?? FASCIA_FINISH_LABEL[r.fascia.finish].toLowerCase()}`, description: `2x sub-fascia across the rafter tails; ${parts}${roof.soffitSqFt ? `; ${roof.soffitSqFt} sq ft of vented soffit` : ""}`, quantity: trimFt || roof.soffitSqFt, unit: trimFt ? "ln ft" : "sqft", material: stepMaterial("trim"), labor: w.amount, exampleMaterial: stepExample("trim"), exampleLabor: w.example });
        }
      }
      if (roof.ceilingSqFt > 0) {
        const w = work("labor.ceiling", roof.ceilingSqFt);
        line({ id: "roof-ceiling", name: `Ceiling — ${design.custom.ceiling?.name ?? CEILING_LABEL[r.ceiling].toLowerCase()}`, description: "On the undersides of the rafters, inside the headers", quantity: roof.ceilingSqFt, unit: "sqft", material: stepMaterial("ceiling"), labor: w.amount, exampleMaterial: stepExample("ceiling"), exampleLabor: w.example });
      }
      if (roof.gutters) {
        const g = roof.gutters;
        const w = sum(work("labor.gutters", g.lf), work("labor.downspout", g.downspouts));
        line({ id: "roof-gutters", name: `Gutters — ${design.custom.gutters?.name ?? GUTTER_LABEL[g.kind].toLowerCase()}`, description: `${plural(g.downspouts, "downspout")}${g.downspoutSize ? ` (${g.kind === "half-round-copper" ? "round copper" : g.downspoutSize})` : ""} to splash blocks; hidden hangers every ${roof.roofLoad >= 30 ? 18 : 24} in.${g.guardsLf ? "; gutter guards" : ""}`, quantity: Math.round(g.lf), unit: "ln ft", material: stepMaterial("gutters"), labor: w.amount, exampleMaterial: stepExample("gutters"), exampleLabor: w.example });
      }
      if (r.cupola) {
        const w = work("labor.cupola", 1);
        line({ id: "roof-cupola", name: "Cupola at the peak", description: "30-in. cupola with louvers and its own roof", quantity: 1, unit: "ea", material: stepMaterial("cupola"), labor: w.amount, exampleMaterial: stepExample("cupola"), exampleLabor: w.example });
      }
    }
    if (roof.walls) {
      const w = work("labor.walls", roof.walls.sqFt);
      line({ id: "roof-walls", name: `Walls between the posts — ${design.custom.walls?.name ?? WALL_FILL_LABEL[roof.walls.fill].toLowerCase()}`, description: `${plural(roof.walls.segments.length, "side")}${roof.walls.fill === "screen" ? `, screen over a 36-in. kneewall${roof.walls.doors ? `, ${plural(roof.walls.doors, "screen door")}` : ""}` : ", floor to header, framed in 2x4"}`, quantity: roof.walls.sqFt, unit: "sqft", material: stepMaterial("walls"), labor: w.amount, exampleMaterial: stepExample("walls"), exampleLabor: w.example });
    }
  }

  /* ── The electrical ───────────────────────────────────────────────── */
  const el = s.electrical;
  if (el.on) {
    const wiring = sum(work("labor.elec.device", el.labor.devices), work("labor.elec.circuit", el.labor.circuits), work("labor.elec.wireFt", el.labor.wireFt), work("labor.elec.trench", el.labor.trenchFt), work("labor.elec.lv", el.labor.lvFixtures));
    const isFixture = (l: PricedBomLine) => l.kind === "fixture";
    // The circuits as a count by kind — eight heaters are "8 30-A two-pole circuits for heaters", not eight sentences.
    const lightCircuits = el.circuits.filter((c) => c.kind === "lights-outlets");
    const heaterCircuits = new Map<string, number>();
    for (const c of el.circuits) if (c.kind !== "lights-outlets") { const k = `${c.amps}-A${c.poles === 2 ? " two-pole" : ""}`; heaterCircuits.set(k, (heaterCircuits.get(k) ?? 0) + 1); }
    const circuitWords = [
      lightCircuits.length ? `${lightCircuits.length === 1 ? "a 20-A GFCI circuit" : `${lightCircuits.length} 20-A GFCI circuits`} for ${plural(lightCircuits.reduce((a, c) => a + c.devices, 0), "device")}` : null,
      ...[...heaterCircuits.entries()].map(([k, n]) => (n === 1 ? `a ${k} circuit for a heater` : `${n} ${k} circuits for heaters`)),
    ].filter((w): w is string => !!w).join("; ");
    line({
      id: "elec-wiring",
      name: `Electrical — ${plural(el.circuits.length, "circuit")}, wiring and boxes`,
      description: `${circuitWords}; ${el.labor.wireFt} ft of wire${el.lv ? `; ${plural(el.lv.transformers, "low-voltage transformer")}` : ""}${el.trenchFt ? `; ${el.trenchFt} ft of trench and conduit` : ""}; ${plural(el.boxes, "weatherproof box", "weatherproof boxes")}, ${plural(el.switches, "switch", "switches")}${el.dimmers ? `, ${plural(el.dimmers, "dimmer")}` : ""}${el.timers ? ", a timer" : ""}. Licensed electrician; permit not included.`,
      quantity: 1,
      unit: "lot",
      material: stepMaterial("electrical", (l) => !isFixture(l)),
      labor: wiring.amount,
      exampleMaterial: stepExample("electrical", (l) => !isFixture(l)),
      exampleLabor: wiring.example,
    });
    const ours = el.fixtures.filter((f) => f.supply === "we");
    if (ours.length) {
      const hang = work("labor.elec.hang", ours.filter((f) => f.kind === "chandelier" || f.kind === "fan" || f.kind === "heater").reduce((a, f) => a + f.qty, 0));
      const count = ours.reduce((a, f) => a + (f.kind === "led-strip" ? 1 : f.qty), 0);
      line({ id: "elec-fixtures", name: `Fixtures — ${plural(count, "fixture")} supplied and hung`, description: [...new Set(ours.map((f) => design.electrical.fixtures.find((x) => x.id === f.designId)?.custom?.name ?? FIXTURE_LABEL[f.kind].toLowerCase()))].join(", "), quantity: count, unit: "ea", material: stepMaterial("electrical", isFixture) - stepMaterial("electrical", (l) => isFixture(l) && !!l.byClient), labor: hang.amount, exampleMaterial: stepExample("electrical", (l) => isFixture(l) && !l.byClient), exampleLabor: hang.example });
    }
    if (el.byClient.length) {
      const hang = work("labor.elec.hang", el.byClient.filter((f) => f.kind === "chandelier" || f.kind === "fan" || f.kind === "heater").reduce((a, f) => a + f.qty, 0));
      const count = el.byClient.reduce((a, f) => a + (f.kind === "led-strip" ? 1 : f.qty), 0);
      line({ id: "elec-client", name: `Fixtures by the client — ${plural(count, "fixture")}, to be determined`, description: `${[...new Set(el.byClient.map((f) => FIXTURE_LABEL[f.kind].toLowerCase()))].join(", ")}: shown in place as a sample; the fixtures are the client's to buy and are not priced here. Their boxes, wire and switches are in the electrical line; the hanging is below.`, quantity: count, unit: "ea", material: 0, labor: hang.amount, exampleMaterial: 0, exampleLabor: hang.example, tbd: true });
    }
  }

  /* ── Items of the contractor's own (2026-10-12) ─────────────────────── */
  {
    const own = bom.filter((l) => l.step === "own");
    if (own.length) {
      line({ id: "own-items", name: `Other materials — ${plural(own.length, "item")}`, description: own.map((l) => `${l.qty} ${l.unit} ${l.label}`).join("; "), quantity: 1, unit: "lot", material: own.reduce((a, l) => a + l.cost, 0), labor: 0, exampleMaterial: 0, exampleLabor: 0 });
    }
  }

  /* ── Tear-out ─────────────────────────────────────────────────────── */
  if (design.extras.demoSqFt > 0) {
    const w = work("labor.demo", design.extras.demoSqFt);
    line({ id: "deck-demo", name: "Tear out and haul away the old deck", quantity: design.extras.demoSqFt, unit: "sqft", material: 0, labor: w.amount, exampleMaterial: 0, exampleLabor: w.example });
  }

  const subtotal = round2(lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0));
  const materialSubtotal = round2(lines.reduce((a, l) => a + l.quantity * l.materialCost, 0));
  const laborSubtotal = round2(lines.reduce((a, l) => a + l.quantity * l.laborCost, 0));
  return {
    design,
    structure: s,
    frame,
    roof,
    takeoff,
    bom,
    lines,
    subtotal,
    materialSubtotal,
    laborSubtotal,
    areaSqFt: area,
    pricePerSqFt: area > 0 ? round2(subtotal / area) : 0,
    exampleShare: subtotal > 0 ? Math.min(1, Math.max(0, Math.round((exampleMoney / subtotal) * 1000) / 1000)) : 0,
    storeShare: materialSubtotal > 0 ? Math.min(1, Math.round((bom.filter((l) => l.source === "store").reduce((a, l) => a + l.cost, 0) / materialSubtotal) * 1000) / 1000) : 0,
    railFt,
    stairSteps,
    market: opts.market,
  };
}

/* ------------------------------------------------------------------ */
/*  The client's scope                                                 */
/* ------------------------------------------------------------------ */

/** What the client reads: the work, in plain sentences. No prices, no estimate words. */
export function deckScope(pkg: DeckPackage, where?: string | null): string[] {
  const { frame, takeoff, roof, design, structure: s } = pkg;
  const out: string[] = [];
  if (frame && takeoff.surface) {
    const height = design.heightIn >= 24 ? ftIn(design.heightIn) : `${design.heightIn} in.`;
    out.push(`Build a ${sizeWords(design)} ${design.structure === "covered-deck" ? "covered deck" : "deck"} (${Math.round(pkg.areaSqFt)} sq ft), ${height} above the ground${where ? `, at ${where}` : ""} — ${PLACEMENT_LABEL[design.placement].split(" — ")[0].toLowerCase()}${design.placement === "attached" ? ", carried on a ledger" : design.placement === "beside" ? ", standing on its own posts" : ""}.`);
    const allPosts = structureLevels(s).flatMap((l) => l.frame.posts);
    const poured = allPosts.filter((p) => p.footing.type === "poured").length;
    const postWords = design.framing.post === OC_POST ? "OC Lumber posts (three 2x6 boards screwed together)" : `${design.framing.post} posts`;
    out.push(poured ? `${plural(poured, "poured concrete footing")}, ${footingDepthIn(design)} in. deep, sized for the load each one carries; ${postWords} on metal bases, held off the concrete${s.gradePct >= 2 ? `; the posts cut to the ground's fall` : ""}.` : `${plural(allPosts.length, "precast pier block")} under ${postWords}.`);
    const beamSizes = [...new Set(frame.beams.map((b) => b.spec.size))].join(" and ");
    out.push(`Frame in ${frame.group === "OC" ? "Owens Corning OC Lumber, a glass-fiber composite that does not rot or rust, screwed together with stainless screws" : speciesWords(frame.species)}: ${frame.joistSize} joists ${frame.spacingIn} in. on center on ${frame.beams.length === 1 ? `a ${beamSizes} beam` : `${beamSizes} beams`}${frame.beamStyle === "flush" ? " set flush with the joists" : ""}, metal hangers and ties at every connection${design.framing.doubleRim ? ", doubled rim and outside joists" : ""}${design.framing.joistTape ? ", protective tape on every joist top" : ""}.`);
    if (frame.ledgers.length) out.push(`Ledger fastened to the house with ${LEDGER_FASTENER_LABEL[design.ledger.fastener]}, flashed above and behind so water cannot reach the house framing, and tied to the house against sideways movement.`);
    if (s.lower?.place === "under") out.push(`A double deck: a second deck of the same size under it, ${ftIn(design.lower.heightIn)} above the ground and ${ftIn(s.lower.dropIn)} below the upper one, framed the same way. Its beams are let into the same posts, which with their footings are sized to carry both decks.`);
    else if (s.lower) out.push(`A lower level in front, ${design.lower.widthFt} × ${design.lower.depthFt} ft, ${ftIn(s.lower.dropIn)} down, framed the same way on its own posts.`);
    out.push(`${frame.decking.label} decking${takeoff.surface.pattern === "diagonal" ? ", laid on the diagonal" : takeoff.surface.pattern === "herringbone" ? ", laid in a herringbone" : ""}${takeoff.surface.border ? ` with a ${takeoff.surface.border === 2 ? "double " : ""}picture-frame border${takeoff.surface.product.border ? ` in ${takeoff.surface.product.border.name}` : ""}` : ""}, fastened with ${takeoff.surface.fastening === "hidden" ? "hidden fasteners" : "coated deck screws"}${takeoff.surface.fascia.on ? "; fascia boards on the open edges" : ""}.`);
  } else if (roof) {
    out.push(`Build a ${structureWords(design)}${where ? ` at ${where}` : ""}, ${roof.floor === "slab" ? `on a new 4-in. concrete slab (${roof.slab?.sqFt ?? 0} sq ft)` : roof.floor === "existing" ? "on the existing concrete slab or patio (no concrete in this price; it must be sound and at least 4 in. thick)" : "on poured footings"}${roof.attach === "wall" ? ", against the house" : ""}.`);
  }
  if (roof) {
    const r = roof.roof;
    if (roof.kind === "pergola") {
      out.push(`Pergola over it: ${plural(roof.posts.length, `${r.post} post`)} ${ftIn(r.eaveHeightIn)} to the headers, ${roof.archRafters ? "arched " : ""}${roof.rafters.size} rafters ${roof.rafters.spacingIn} in. apart with ${roof.louvers ? "louvers that open and close" : `${r.slats.size} slats ${r.slats.spacingIn} in. apart`} on top, ${ftIn(r.overhangIn)} overhang all round${roof.hardware.braces ? ", knee braces at the posts" : ""}.`);
    } else {
      const kindName = ROOF_KIND_LABEL[roof.kind].split(" — ")[0].toLowerCase();
      out.push(`${roof.attach === "wall" ? "A" : "A free-standing"} ${kindName} roof over it, ${r.pitch}:12 pitch, ${ftIn(r.eaveHeightIn)} to the headers${roof.floor === "deck" ? " above the deck" : ""}: ${plural(roof.posts.length, `${r.post} post`)}${roof.floor === "deck" ? " from their own footings through the deck" : ""}, ${[...new Set(roof.headers.map((h) => h.spec.size))].join(" and ")} headers, ${roof.trusses ? `manufactured trusses 24 in. on center spanning ${ftIn(roof.trusses.spanIn)} (the truss maker's stamped drawings go with the permit)` : `${roof.rafters.size} rafters ${roof.rafters.spacingIn} in. on center`}${roof.hips.count ? ` with ${roof.hips.nominal} hips` : ""}${roof.ridge ? (roof.ridge.kind === "beam" ? `, a ${roof.ridge.spec?.size ?? roof.ridge.nominal} ridge beam` : `, a ${roof.ridge.nominal} ridge board${roof.ties ? " and rafter ties" : ""}`) : ""}${roof.ledger ? `, a ${roof.ledger.nominal} ledger on the house, flashed` : ""}; ${ftIn(r.overhangIn)} overhang.`);
      out.push(`${design.custom.roofing?.name ?? ROOFING_LABEL[r.roofing]} over ${roof.sheets > 0 ? "1/2-in. sheathing and synthetic underlayment" : "2x4 purlins"}, drip edge on every edge${roof.wallFt ? ", step and counter flashing where the roof meets the house" : ""}${r.fascia.eave || r.fascia.rake ? `; ${FASCIA_FINISH_LABEL[r.fascia.finish].toLowerCase()} fascia${r.fascia.rake && roof.rakeFt ? " and rake boards" : ""}` : ""}${roof.soffitSqFt ? "; vented soffit under the eaves" : ""}${roof.ceilingSqFt ? `; ${CEILING_LABEL[r.ceiling].toLowerCase()} ceiling` : ""}${r.cupola ? "; a cupola at the peak" : ""}.`);
      if (roof.gutters) out.push(`${design.custom.gutters?.name ?? `${GUTTER_LABEL[roof.gutters.kind]} gutters`} on the eaves (${Math.round(roof.gutters.lf)} ft) with ${plural(roof.gutters.downspouts, "downspout")} to splash blocks${roof.gutters.guardsLf ? ", with gutter guards" : ""}.`);
    }
    if (roof.walls) out.push(`${design.custom.walls?.name ?? WALL_FILL_LABEL[roof.walls.fill]} on ${plural(roof.walls.segments.length, "side")}${roof.walls.doors ? `, with ${roof.walls.doors === 1 ? "a screen door" : `${roof.walls.doors} screen doors`}` : ""}.`);
    // What the builder set by hand (2026-11-13): said in the scope the client signs.
    if (roof.openings.length || roof.pins.length) out.push(`${roofByHandWords(roof).replace(/^a /, "A ")}; the headers sized for the spans they make.`);
  }
  if (pkg.railFt > 0) out.push(`${railWords(s.rails).replace(/^(\d)/, "$1")}.`);
  for (const st of s.stairs) out.push(st.kind === "box" ? `${st.wide ? "Wide steps on cut stringers" : "Box steps"} wrapping ${st.design.wrapSides === 4 ? "all four sides" : st.design.wrapSides === 3 ? "three sides" : "the front"}, ${plural(st.risers, "riser")} of ${st.riserIn.toFixed(2)} in.` : `A ${st.widthIn / 12}-ft-wide stair down the ${st.design.side}: ${plural(st.risers, "riser")} of ${st.riserIn.toFixed(2)} in., treads ${st.runIn + 1} in. deep${st.lands === "lower-deck" ? ", onto the lower level" : st.design.landing === "pad" ? ", onto a new concrete pad" : st.design.landing === "patio" ? ", onto the existing patio" : ", onto pavers"}${st.rail.sides ? `, ${st.rail.sides === 2 ? "rails on both sides" : "a handrail"}` : ""}.`);
  if (s.electrical.on) {
    const el = s.electrical;
    out.push(`Electrical: ${electricalWords(el).toLowerCase()} — ${[...new Set(el.fixtures.map((f) => FIXTURE_LABEL[f.kind].toLowerCase()))].join(", ")}, on ${plural(el.circuits.length, "new circuit")} from the panel, weatherproof boxes and GFCI protection, by a licensed electrician.`);
    if (el.byClient.length) out.push(`${el.byClient.length === 1 ? "One fixture" : `${el.byClient.length} fixtures`} (${[...new Set(el.byClient.map((f) => FIXTURE_LABEL[f.kind].toLowerCase()))].join(", ")}) to be chosen and bought by you; we wire the boxes and hang them.`);
  }
  for (const b of s.builtIns) if (b.built) out.push(b.kind === "planter" ? `${builtInWords(b).replace(/^a /, "A ").replace(/^an /, "An ")}, in the deck's own boards with a cap round the rim, lined and drained. Soil and plants are not included.` : `${builtInWords(b).replace(/^a /, "A ").replace(/^an /, "An ")}, built in: the seat in the deck's own boards on treated legs, a fascia apron under its edge${b.kind === "bench-back" ? ", a capped back behind it" : ""}.`);
  if (s.skirt) out.push(`Skirting under the deck on its open sides (${Math.round(s.skirt.lf)} ft): ${s.skirt.kind === "lattice" ? "lattice in a border" : "the deck's own boards laid level, with gaps for air"}, on a treated frame, stopped a hand above the ground, with one hinged panel to get under the deck.`);
  if (design.extras.underDeckDrain) out.push("An under-deck drainage system keeps the space below the deck dry.");
  if (design.extras.demoSqFt > 0) out.push(`Tear-out and haul-away of the existing deck, ${design.extras.demoSqFt} sq ft.`);
  out.push("Layout squared and checked before digging; site cleaned when the work is done.");
  // The code the deck is sized and checked to — the job's state's own edition (lib/deck/stateCodes); the inspector reads it here.
  out.push(`Built to the ${s.code.name}${s.code.since ? ` (in force since ${s.code.since})` : ""}; the building office's edition and amendments govern.`);
  return out;
}

/** The words under the numbers: what the price assumed and what it leaves to the owner. */
export function deckNotes(pkg: DeckPackage): string[] {
  const { frame, roof, design, structure: s } = pkg;
  const out: string[] = [];
  // The code it is checked against — the state's own edition (lib/deck/stateCodes); the building office's edition and amendments govern.
  out.push(codeWords(s.code));
  if (frame) {
    out.push(`${frame.group === "OC" ? "Framing sized from Owens Corning's OC Lumber span tables (September 2024) and DrJ Engineering's listing 2302-42 — OC Lumber is not in the code's deck tables, so the building department reviews it as an alternative material" : `Framing sized from the deck tables of the International Residential Code (Section R507)${frame.beams.some((b) => b.table === "DCA6") ? " and the American Wood Council's DCA 6 guide" : ""}`} for a ${design.loadPsf} psf load${design.site.groundSnowPsf > 40 ? ` (the ${design.site.groundSnowPsf} psf ground snow here)` : ""}. The building department has the final word; permit fees and engineered drawings are not included.`);
    out.push(`Footings assume soil that bears ${design.soilPsf.toLocaleString("en-US")} psf${design.placement === "attached" ? ` and a frost depth of ${design.frostIn} in.` : ""}; rock, fill or a deeper frost line changes them.${s.gradePct >= 2 ? ` The ground's fall (${s.gradePct}%) is as read or typed; the real grade is checked on site.` : ""}`);
    if (design.site.termite === "very-heavy" || design.site.termite === "moderate-heavy") out.push(`Termite hazard here is ${TERMITE_LABEL[design.site.termite]}: ground-contact lumber near the soil and clearance at the posts are in the plan.`);
  }
  if (roof && roof.kind !== "pergola") {
    out.push(`Rafters sized from ${RULE_RAFTER[roof.roofLoad]} (${roof.roofLoad} psf ${roof.roofLoad === 20 ? "roof live load" : "ground snow load"}); headers and ridge from the deck beam tables at the roof's load${roof.engineered ? ", engineered beams by the usual LVL figures" : ""} — the building department may ask for an engineer's letter on the roof beams.${roof.attach === "wall" ? " Where the roof meets the house, the siding is cut back and flashed; the house framing behind must be sound." : ""}`);
    if (roof.roofLoad >= 30) out.push("In snow country the building office may require an ice barrier along the eaves; it is not in this price unless listed.");
  }
  if (roof?.kind === "pergola") out.push("A pergola gives shade, not shelter: its slats are open to rain by design.");
  if (roof?.floor === "slab") out.push("The slab assumes level, compacted ground; grading, drainage and a vapour barrier under it are quoted separately when needed.");
  if (!frame && roof) out.push(`Footings assume soil that bears ${design.soilPsf.toLocaleString("en-US")} psf; rock, fill or a deeper frost line changes them. Permit fees and engineered drawings are not included.`);
  if (frame && design.heightIn > GUARD_REQUIRED_ABOVE_IN && pkg.railFt === 0) out.push("A deck this high needs a guard rail on its open edges; railing is not in this price.");
  if (s.stairs.some((st) => st.pad)) out.push("Stair pads are poured on compacted ground at the foot of the stairs; the pad's position moves with the stairs.");
  if (s.electrical.on) out.push(...s.electrical.notes);
  if (frame && (frame.decking.family === "treated" || frame.decking.family === "softwood" || frame.decking.family === "hardwood")) out.push("Wood decking is natural: color change, small checks and some movement with the seasons are normal, not defects. Sealing or staining is the owner's upkeep.");
  out.push("811 marks public utilities; the owner marks private ones — sprinklers, drains, low-voltage, septic. Property lines, setbacks and HOA approval are the owner's to confirm.");
  return out;
}

export { roofWords };
