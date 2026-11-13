// THE DECK PRICE BOOK (2026-10-04) — pure.
//
// One row for everything a deck is bought or built by: lumber by the foot,
// deck boards by the foot, each connector, a bag of concrete, and the crew's
// work BY MEASURE (a square foot framed, a footing set, a foot of ledger
// hung) — never by the hour, the same way the fence and roof estimators
// price work.
//
// EVERY DEFAULT HERE IS AN EXAMPLE. No public source gave a deck material
// price or a labor rate that could be checked (2026-10-04 research), and the
// owner asked for placeholders he can replace. So the studio marks a price
// that still stands on a default as "example", and the shop's own number —
// typed once, saved in its book — is what the job is priced at from then on.
//
// SPARSE, like the fence book (lib/fence/rates.ts): only what the shop
// changed is stored, a value equal to the default is dropped, and a rate
// nobody touched keeps following the platform's default.
//
// A default is scaled to the job's market (state + ZIP, lib/fence/market);
// a rate the contractor typed is the number they charge, taken as typed.

import { DECKING, RAIL_TYPES } from "./catalog";
import { laborFactor, type MarketBasis, type MarketSnapshot } from "../fence/market";
import { storePrice } from "./storePrices";

export type DeckRateGroup = "lumber" | "decking" | "hardware" | "concrete" | "roof" | "trim" | "gutters" | "labor" | "roofLabor" | "allowance" | "electrical";
export const DECK_RATE_GROUP_LABEL: Record<DeckRateGroup, string> = {
  lumber: "Framing lumber",
  decking: "Deck boards and fascia",
  hardware: "Connectors and fasteners",
  concrete: "Footings and slab",
  roof: "Roofing and roof deck",
  trim: "Fascia, soffit and ceiling",
  gutters: "Gutters",
  labor: "Labor, by measure — deck",
  roofLabor: "Labor, by measure — roof",
  allowance: "Railing, stairs, lights and cupola",
  electrical: "Electrical and accessories",
};

export interface DeckRateDef {
  key: string;
  label: string;
  /** What one price buys: "ft", "ea", "sq ft", "bag". */
  unit: string;
  /** The EXAMPLE default, national. */
  price: number;
  group: DeckRateGroup;
  /** What moves it from market to market: a commodity basis, the labor index, or nothing. */
  basis: MarketBasis | "labor" | null;
  min: number;
  max: number;
}

const lumber = (nominal: string, price: number): DeckRateDef => ({ key: `lf.${nominal}`, label: `${nominal} framing lumber`, unit: "ft", price, group: "lumber", basis: "vinyl", min: 0.1, max: 80 });
const hw = (key: string, label: string, price: number, unit = "ea", max = 400): DeckRateDef => ({ key: `hw.${key}`, label, unit, price, group: "hardware", basis: "metal", min: 0.01, max });
const labor = (key: string, label: string, unit: string, price: number, max = 400): DeckRateDef => ({ key: `labor.${key}`, label, unit, price, group: "labor", basis: "labor", min: 0.1, max });
const roofLabor = (key: string, label: string, unit: string, price: number, max = 2000): DeckRateDef => ({ key: `labor.${key}`, label, unit, price, group: "roofLabor", basis: "labor", min: 0.1, max });
const roof = (key: string, label: string, unit: string, price: number, basis: MarketBasis = "vinyl", max = 2000): DeckRateDef => ({ key: `roof.${key}`, label, unit, price, group: "roof", basis, min: 0.05, max });
const trim = (key: string, label: string, unit: string, price: number, basis: MarketBasis = "vinyl", max = 400): DeckRateDef => ({ key: `trim.${key}`, label, unit, price, group: "trim", basis, min: 0.05, max });
const gut = (key: string, label: string, unit: string, price: number, max = 400): DeckRateDef => ({ key: `gut.${key}`, label, unit, price, group: "gutters", basis: "metal", min: 0.05, max });
const elec = (key: string, label: string, unit: string, price: number, max = 2000): DeckRateDef => ({ key: `elec.${key}`, label, unit, price, group: "electrical", basis: "metal", min: 0.05, max });
const elecLabor = (key: string, label: string, unit: string, price: number, max = 2000): DeckRateDef => ({ key: `labor.elec.${key}`, label, unit, price, group: "electrical", basis: "labor", min: 0.1, max });

/**
 * Framing lumber is priced on the freight-only basis ("vinyl" in the market
 * tables), not on the pine or cedar basis: a shop frames in the species its
 * own region mills, so the lumber is local wherever the deck is.
 */
export const DECK_RATES: readonly DeckRateDef[] = [
  lumber("2x4", 0.75),
  lumber("2x6", 1.1),
  lumber("2x8", 1.5),
  lumber("2x10", 2.1),
  lumber("2x12", 2.8),
  lumber("4x4", 1.9),
  lumber("4x6", 3.6),
  lumber("4x8", 6),
  lumber("4x10", 7.5),
  lumber("4x12", 9.5),
  lumber("6x6", 5.5),
  lumber("8x8", 11),
  lumber("2x2", 0.55),
  lumber("1x8", 1.6),
  lumber("1x10", 2.2),
  ...DECKING.map((d): DeckRateDef => ({ key: `deck.${d.id}`, label: d.label, unit: "ft", price: d.pricePerLf, group: "decking", basis: d.basis, min: 0.2, max: 60 })),
  { key: "fascia.wood", label: "Fascia board, wood", unit: "ft", price: 2.2, group: "decking", basis: "cedar", min: 0.2, max: 60 },
  { key: "fascia.composite", label: "Fascia board, composite or PVC", unit: "ft", price: 5, group: "decking", basis: "vinyl", min: 0.2, max: 60 },
  { key: "fast.screws", label: "Deck screws, per square foot of deck", unit: "sq ft", price: 0.35, group: "hardware", basis: "metal", min: 0.01, max: 20 },
  { key: "fast.hidden", label: "Hidden clips and screws, per square foot of deck", unit: "sq ft", price: 1.1, group: "hardware", basis: "metal", min: 0.01, max: 20 },
  { key: "fast.framing", label: "Framing nails and screws, per square foot of deck", unit: "sq ft", price: 0.25, group: "hardware", basis: "metal", min: 0.01, max: 20 },
  hw("hanger", "Joist hanger", 2.5),
  hw("hangerDouble", "Double joist hanger", 5.5),
  hw("tie", "Hurricane tie, joist to beam", 1.2),
  hw("connectorFasteners", "Nails or screws for one connector", 0.6),
  hw("postBase", "Post base, 6x6", 18),
  hw("postCap", "Post cap, 6x6", 14),
  hw("anchorBolt", "Anchor bolt for a post base", 2.5),
  hw("lag", "1/2-in. lag screw with washer", 1.4),
  hw("bolt", "1/2-in. through-bolt, nut and washers", 2.4),
  hw("ledgerlok", "LedgerLOK structural screw", 1.1),
  hw("sdws", "Simpson SDWS structural screw", 1),
  hw("anchor", "1/2-in. concrete anchor", 3.5),
  hw("holddown", "Lateral hold-down, 1,500 lb, with rod", 28),
  hw("holddownSmall", "Lateral tie, 750 lb", 9),
  hw("structScrew", "Structural wood screw, rim to joist", 0.45),
  hw("flashing", "Ledger cap flashing", 2.5, "ft"),
  hw("membrane", "Flashing membrane tape", 0.9, "ft"),
  hw("joistTape", "Joist tape", 0.35, "ft"),
  { key: "conc.bag", label: "Concrete, 80-lb bag", unit: "bag", price: 7, group: "concrete", basis: "vinyl", min: 1, max: 60 },
  { key: "conc.tube", label: "Form tube, 12 in. (wider tubes in proportion)", unit: "ft", price: 3.9, group: "concrete", basis: "vinyl", min: 0.2, max: 80 },
  { key: "conc.pierBlock", label: "Precast pier block", unit: "ea", price: 14, group: "concrete", basis: "vinyl", min: 1, max: 200 },
  labor("framing", "Framing — beams, joists, rim, blocking, hardware", "sq ft", 9),
  labor("decking.wood", "Laying softwood deck boards", "sq ft", 6),
  labor("decking.hardwood", "Laying hardwood deck boards", "sq ft", 11),
  labor("decking.composite", "Laying composite deck boards", "sq ft", 8),
  labor("decking.pvc", "Laying PVC deck boards", "sq ft", 8),
  labor("decking.aluminum", "Laying aluminum planks", "sq ft", 9),
  labor("diagonal", "Extra for boards laid on the diagonal", "sq ft", 1.5),
  labor("footing", "Dig, form and pour one footing", "ea", 85, 2000),
  labor("pierBlock", "Set one pier block", "ea", 20, 2000),
  labor("ledger", "Ledger — siding off, flash, fasten", "ft", 6),
  labor("fascia", "Fascia", "ft", 4),
  labor("brace", "Cut and fit one knee brace", "ea", 15, 2000),
  labor("demo", "Tear out and haul away an old deck", "sq ft", 4),
  ...RAIL_TYPES.filter((r) => r.id !== "none" && r.id !== "custom").flatMap((r): DeckRateDef[] => [
    { key: `rail.${r.id}.material`, label: `Railing, ${r.label.toLowerCase()} — material`, unit: "ft", price: r.perFt[0], group: "allowance", basis: r.basis, min: 0.5, max: 1500 },
    { key: `rail.${r.id}.labor`, label: `Railing, ${r.label.toLowerCase()} — labor`, unit: "ft", price: r.perFt[1], group: "allowance", basis: "labor", min: 0.5, max: 1500 },
  ]),
  { key: "stairs.labor", label: "Stairs — labor, per riser per foot of width (stringers, treads, risers)", unit: "step·ft", price: 20, group: "allowance", basis: "labor", min: 0.5, max: 500 },
  // ── Stairs, rails, lights, the site (M3, 2026-10-10). EXAMPLE prices.
  { key: "stairs.boxLabor", label: "Box steps — labor, per foot of frame", unit: "ft", price: 7, group: "allowance", basis: "labor", min: 0.5, max: 200 },
  { key: "stairs.pad", label: "Stair pad — form, pour and finish one", unit: "ea", price: 190, group: "allowance", basis: "labor", min: 10, max: 2000 },
  { key: "stairs.landing", label: "Stair landing — frame and post one", unit: "ea", price: 420, group: "allowance", basis: "labor", min: 10, max: 5000 },
  hw("stringerConnector", "Stair stringer connector", 9),
  hw("railPostTie", "Rail post tension ties, pair, with bolts", 16),
  hw("railBracket", "Rail bracket", 2.2),
  // By the mount (2026-11-13): a rated base under a top-mounted wood post; the rail maker's fascia bracket for a side-mounted metal one.
  hw("railPostBase", "Guard post base, rated, 4x4 on the deck", 38),
  hw("railFasciaBracket", "Fascia-mount rail post bracket", 34),
  hw("postCapWood", "Post cap, decorative", 9),
  // Rail infill bought by the piece (2026-11-09), at DecksDirect's listed prices that month: Deckorators Classic round
  // aluminum balusters, Satin Black, $17.97 for ten; a Wild Hog welded mesh panel, 36 in. x 6 ft, $82.79.
  hw("metalBaluster", "Round aluminum baluster, black", 1.8),
  hw("meshPanel", "Welded wire mesh rail panel, 6 ft", 82.79, "ea", 600),
  hw("litCap", "Lit post cap, low voltage", 34),
  hw("riserLight", "Stair riser light", 26),
  hw("lightKit", "Low-voltage transformer, wire and timer", 140, "ea", 2000),
  { key: "rim.curved", label: "Curved rim — laminated plywood plies, per foot per ply", unit: "ft", price: 4.2, group: "lumber", basis: "vinyl", min: 0.2, max: 60 },
  { key: "conc.gravel", label: "Gravel base, 4 in.", unit: "sq ft", price: 1.9, group: "concrete", basis: "vinyl", min: 0.1, max: 40 },
  { key: "conc.paver", label: "Paver, 12 in., on sand", unit: "ea", price: 3.6, group: "concrete", basis: "vinyl", min: 0.2, max: 60 },
  labor("lighting", "Set and wire one light", "ea", 28, 500),
  labor("stepDown", "Build the step between two levels", "ft", 18),
  // ── Walls, lights, drainage and engineered beams for the roof (M3). EXAMPLE prices.
  trim("screen", "Screen panels, framed, between posts", "sq ft", 9.5),
  trim("screenDoor", "Screen door, hung", "ea", 420, "vinyl", 5000),
  trim("lattice", "Lattice panels, framed", "sq ft", 6.2, "cedar"),
  trim("privacy", "Solid privacy panels, framed", "sq ft", 11, "cedar"),
  trim("fan", "Outdoor ceiling fan, wet-rated, with box and switch", "ea", 380, "metal", 5000),
  trim("light", "Outdoor light fixture, wet-rated, with box", "ea", 120, "metal", 2000),
  trim("circuit", "New circuit to the structure, GFCI", "ea", 650, "metal", 10000),
  trim("underDeckDrain", "Under-deck drainage system (troughs, gutter, downspout)", "sq ft", 9, "vinyl"),
  trim("louverKit", "Louvered pergola slats, manual, per square foot of cover", "sq ft", 38, "metal", 400),
  { key: "lf.lvl", label: "LVL beam, 1 3/4-in. ply, per foot per inch of depth", unit: "ft·in", price: 0.95, group: "lumber", basis: "vinyl", min: 0.05, max: 20 },
  { key: "lf.truss", label: "Manufactured roof truss, per foot of span", unit: "ft", price: 8.5, group: "lumber", basis: "vinyl", min: 0.05, max: 20 },
  { key: "lf.archRafter", label: "Arched rafter, cut from 2x12 stock (two boards each)", unit: "ft", price: 6.4, group: "lumber", basis: "vinyl", min: 0.2, max: 80 },
  roofLabor("walls", "Framing and hanging wall panels", "sq ft", 5.5, 400),
  roofLabor("underDeckDrain", "Hang the under-deck drainage", "sq ft", 3.8, 400),
  // ── Electrical and accessories (M3, 2026-10-10). EXAMPLE prices; the shop's electrician sets the real ones.
  elec("wire122", "12/2 UF-B wire", "ft", 1.35),
  elec("wire102", "10/2 UF-B wire", "ft", 2.1),
  elec("wireLv", "16/2 low-voltage landscape wire", "ft", 0.55),
  elec("conduit", "3/4-in. PVC conduit with fittings", "ft", 2.4),
  elec("box", "Weatherproof box with in-use cover", "ea", 24),
  elec("gfci", "Weather-resistant GFCI receptacle", "ea", 32),
  elec("switch", "Weatherproof switch", "ea", 18),
  elec("dimmer", "Dimmer", "ea", 42),
  elec("fanControl", "Fan speed control", "ea", 38),
  elec("timer", "Timer or photocell", "ea", 48),
  elec("breaker20", "20-A breaker", "ea", 14),
  elec("breaker30", "30-A two-pole breaker", "ea", 36),
  elec("transformer", "150-W low-voltage transformer with timer", "ea", 120),
  elec("ledStrip", "LED strip, outdoor, warm white", "ft", 6.5),
  elec("postCap", "Lit post cap, low voltage", "ea", 34),
  elec("stepLight", "Stair riser light, low voltage", "ea", 26),
  elec("string", "Commercial string lights, 48-ft strand", "ea", 85),
  elec("sconce", "Outdoor wall sconce", "ea", 95),
  elec("ceilingLight", "Outdoor ceiling light, wet-rated", "ea", 120),
  elec("chandelier", "Outdoor chandelier (allowance)", "ea", 480, 10000),
  elec("fan", "Outdoor ceiling fan, wet-rated", "ea", 380, 5000),
  elec("heater120", "Infrared patio heater, 1,500 W, 120 V", "ea", 260, 5000),
  elec("heater240", "Infrared patio heater, 4,000 W, 240 V", "ea", 520, 5000),
  elec("flood", "Security flood light, motion, LED", "ea", 68),
  elecLabor("device", "Set a box and wire one device", "ea", 85),
  elecLabor("hang", "Hang a chandelier, fan or heater", "ea", 120),
  elecLabor("circuit", "Run and connect one circuit at the panel", "ea", 260, 5000),
  elecLabor("wireFt", "Pull wire, per foot", "ft", 1.6),
  elecLabor("trench", "Trench, conduit and backfill, per foot", "ft", 14),
  elecLabor("lv", "Set one low-voltage fixture (strips per 10 ft)", "ea", 22),
  // ── The roof (M2, 2026-10-10). EXAMPLE prices, like everything above.
  hw("hurricaneTie", "Hurricane tie, rafter to header", 1.3),
  hw("rafterHanger", "Rafter hanger, at a ridge beam, ledger or hip", 3.6),
  hw("wedgeAnchor", "Wedge anchor into a slab", 3.2),
  hw("ringPlate", "Steel compression ring for a polygon roof", 140, "ea", 2000),
  hw("kingBracket", "Post-to-beam bracket at a king post or wall", 22),
  hw("beamHanger", "Beam hanger to the house", 38),
  // 2026-10-12: across every header joint of a hip or a gazebo ring — the hips push the corners out (lib/deck/roof).
  hw("cornerStrap", "Tension strap across a header joint", 14),
  hw("roofScrew", "Structural screw, roof ledger to the house", 1.1),
  roof("sheathing", "Roof sheathing, 1/2-in. 4x8 sheet", "ea", 24),
  roof("underlayment", "Synthetic underlayment", "sq", 42),
  roof("nails", "Roofing nails and cap nails", "sq", 9, "metal"),
  roof("shingle.arch", "Architectural shingles", "sq", 125),
  roof("shingle.3tab", "3-tab shingles", "sq", 98),
  roof("shingle.designer", "Designer shingles", "sq", 240),
  roof("shake", "Cedar shakes, medium", "sq", 320, "cedar"),
  roof("starter", "Starter strip", "ft", 1.1),
  roof("hipRidge", "Hip and ridge cap shingles", "ft", 3.6),
  roof("metal.panel", "Metal roof panels, exposed fastener, 36-in. cover", "ft", 3.4, "metal"),
  roof("metal.seam", "Standing-seam metal panels, 16-in. cover", "ft", 7.2, "metal"),
  roof("metal.trim", "Metal eave, rake and ridge trim", "ft", 4.2, "metal"),
  roof("metal.screws", "Metal roofing screws and closures", "sq", 22, "metal"),
  roof("dripEdge", "Drip edge, 10-ft piece", "ea", 9.5, "metal"),
  roof("wallFlashing", "Step and counter flashing at the house", "ft", 4.5, "metal"),
  roof("kickout", "Kickout flashing, pre-formed", "ea", 15, "metal"),
  trim("fascia.wood", "Fascia board, primed 1x8 wood", "ft", 2.4, "cedar"),
  trim("fascia.pvc", "Fascia board, PVC 1x8", "ft", 5.2),
  trim("fascia.wrap", "Aluminum fascia wrap", "ft", 3.4, "metal"),
  trim("soffit", "Vented soffit panel", "sq ft", 2.8),
  trim("ceiling.tg", "Tongue-and-groove ceiling boards", "sq ft", 3.9, "cedar"),
  trim("ceiling.bead", "Beadboard ceiling panels", "sq ft", 2.6),
  gut("k5", "5-in. K-style aluminum gutter", "ft", 4.6),
  gut("k6", "6-in. K-style aluminum gutter", "ft", 6.1),
  gut("halfRoundAlum", "Half-round aluminum gutter", "ft", 9.5),
  gut("halfRoundCopper", "Half-round copper gutter", "ft", 32, 400),
  gut("downspout23", "2x3 downspout", "ft", 3.1),
  gut("downspout34", "3x4 downspout", "ft", 4.2),
  gut("downspoutCopper", "Round copper downspout", "ft", 26),
  gut("hanger", "Hidden hanger with screw", "ea", 2.6),
  gut("endCap", "End cap", "ea", 4.5),
  gut("corner", "Mitred corner", "ea", 11),
  gut("outlet", "Downspout outlet", "ea", 6.5),
  gut("elbow", "Downspout elbow", "ea", 4.2),
  gut("splash", "Splash block or extension", "ea", 13),
  gut("guard", "Gutter guard", "ft", 4.4),
  { key: "conc.slab", label: "Concrete slab, 4 in. — mix, base and mesh", unit: "sq ft", price: 6.8, group: "concrete", basis: "vinyl", min: 0.5, max: 60 },
  { key: "cupola.kit", label: "Cupola, 30 in., with louvers and roof", unit: "ea", price: 680, group: "allowance", basis: "vinyl", min: 10, max: 10000 },
  roofLabor("roofPost", "Set and brace one roof post", "ea", 65),
  roofLabor("roofFrame", "Roof framing — headers, rafters, ridge, hips", "sq ft", 6.5, 400),
  roofLabor("hipExtra", "Extra for hips, pyramids and polygons", "sq ft", 1.6, 400),
  roofLabor("sheathing", "Sheathing and underlayment", "sq ft", 1.7, 400),
  roofLabor("shingles", "Laying shingles or shakes", "sq", 135),
  roofLabor("metal", "Laying metal panels and trim", "sq ft", 3.4, 400),
  roofLabor("roofLedger", "Roof ledger — siding off, flash, fasten", "ft", 7.5),
  roofLabor("trim", "Fascia and rake boards", "ft", 5.2),
  roofLabor("soffit", "Soffit", "sq ft", 3.2, 400),
  roofLabor("ceiling", "Ceiling boards or panels", "sq ft", 4.2, 400),
  roofLabor("gutters", "Hang gutters", "ft", 4.5),
  roofLabor("downspout", "Run one downspout", "ea", 38),
  roofLabor("slab", "Form, pour and finish a slab", "sq ft", 5.5, 400),
  roofLabor("slats", "Pergola slats", "sq ft", 2.4, 400),
  roofLabor("cupola", "Set a cupola", "ea", 320),
];

const BY_KEY = new Map(DECK_RATES.map((r) => [r.key, r]));

/** A post base or cap for another post size, against the 6x6's price. */
export const POST_HARDWARE_FACTOR: Record<string, number> = { "4x4": 0.55, "4x6": 0.7, "6x6": 1, "8x8": 1.8 };
/** Stainless connectors and fasteners, against galvanized — an EXAMPLE factor. */
export const STAINLESS_FACTOR = 2.2;
/** A form tube wider than 12 in., priced in proportion to its width. */
export const tubeFactor = (diameterIn: number) => Math.max(0.6, diameterIn / 12);

/** The shop's own numbers: only the rows it changed. */
export type DeckRateBook = Record<string, number>;

/** Anything → a clean sparse book: known rows, inside their rails, not restating the default. */
export function sanitizeDeckRateBook(raw: unknown): DeckRateBook {
  const out: DeckRateBook = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const def = BY_KEY.get(key);
    const n = Number(val);
    if (!def || val === null || val === "" || !Number.isFinite(n)) continue;
    if (n < def.min || n > def.max) continue;
    const rounded = Math.round(n * 100) / 100;
    if (Math.abs(rounded - def.price) < 0.005) continue;
    out[key] = rounded;
  }
  return out;
}

export interface ResolvedRate {
  price: number;
  /**
   * "book": the shop typed it. "store": Home Depot's listed price, surveyed once (lib/deck/storePrices), scaled to the
   * job's market. "market": the example, scaled to the job's market. "example": the example as is.
   */
  source: "book" | "store" | "market" | "example";
}

/** What one row prices at on this job. An unknown key prices at zero. */
export function deckRate(key: string, book?: DeckRateBook, market?: MarketSnapshot): ResolvedRate {
  const def = BY_KEY.get(key);
  if (!def) return { price: 0, source: "example" };
  const own = book?.[key];
  if (typeof own === "number" && Number.isFinite(own) && own >= def.min && own <= def.max) return { price: own, source: "book" };
  const factor = !market || def.basis === null ? 1 : def.basis === "labor" ? laborFactor(market) : (market.material[def.basis] ?? 1);
  // The store's price where it sells the item (labor never), else the example — either scaled to the job's market.
  const store = def.basis === "labor" ? null : storePrice(key);
  if (store) return { price: factor === 1 ? store.price : Math.round(store.price * factor * 100) / 100, source: "store" };
  return factor === 1 ? { price: def.price, source: "example" } : { price: Math.round(def.price * factor * 100) / 100, source: "market" };
}

export function deckRateDef(key: string): DeckRateDef | undefined {
  return BY_KEY.get(key);
}

/** The whole book as rows, for the rate card: every row, the shop's number where it set one. */
/** Every row with the shop's own number, and its default: the store's price where it sells the item, else the example (`example` keeps the original figure, `store` says which). */
export function deckRateRows(book?: DeckRateBook): Array<DeckRateDef & { own: number | null; example: number; store: boolean }> {
  return DECK_RATES.map((r) => {
    const store = r.basis === "labor" ? null : storePrice(r.key);
    return { ...r, price: store ? store.price : r.price, example: r.price, store: !!store, own: typeof book?.[r.key] === "number" ? book[r.key] : null };
  });
}

/** A price that is neither the shop's own nor a store's: an example (as is, or scaled to the market). */
export const isExampleSource = (s: ResolvedRate["source"]) => s === "example" || s === "market";

/** The lumber row a member is bought on: "2-2x10" and "2x10" are both 2x10 stock. */
export function lumberKey(nominal: string): string {
  return `lf.${nominal.replace(/^\d-/, "")}`;
}
