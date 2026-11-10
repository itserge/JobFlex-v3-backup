// WHAT A DECK IS BUILT FROM (2026-10-04) — pure data.
//
// Owner: "add to the selections all options of wood type that's used in the
// USA for the decks." Three shelves:
//
//   · FRAMING — the species a frame is cut from, each tied to the code's
//     species row its spans are read from (codeTables.ts). The code wants
//     pressure-treated lumber or naturally durable heartwood under a deck
//     (R507.2.1), so "not pressure-treated" is offered only as redwood or
//     cedar heartwood — never as plain untreated fir.
//   · DECKING — the boards the client walks on: treated softwoods, the
//     naturally durable ones, the tropical and domestic hardwoods, modified
//     woods, capped composite, PVC, mineral-based boards and aluminum. Each
//     carries the widest joist spacing it may sit on and WHERE that rule
//     was read: the code's table for sawn wood, the maker's guide where one
//     was read, or the yard's practice (`source: "trade"` — confirm it).
//   · THE WALL — what the house is where the deck meets it, because that
//     decides whether a ledger may be bolted on at all.
//
// PRICES. No public price list was found for any of this, so every price
// here is an EXAMPLE (the owner asked for placeholders he can replace). The
// shop's own numbers live in its price book (rates.ts) and win over these.

import { regionalPicks } from "./regional";
import type { LedgerFastener, SpeciesGroup } from "./codeTables";
import type { MarketBasis } from "../fence/market";

/* ------------------------------------------------------------------ */
/*  Framing species                                                    */
/* ------------------------------------------------------------------ */

export type FramingSpeciesId = "southern-pine" | "hem-fir" | "douglas-fir" | "spf" | "ponderosa-pine" | "red-pine" | "redwood" | "western-cedar";

export interface FramingSpecies {
  id: FramingSpeciesId;
  label: string;
  short: string;
  /** The code's species row its spans are read from. */
  group: SpeciesGroup;
  /** Pressure-treated (true) or naturally durable heartwood (false). */
  treated: boolean;
  /** A hem-fir ledger holds a structural screw less well (the makers' tables tell it apart). */
  hemFir?: boolean;
  /** Where the yards stock it. */
  region: string;
  note: string;
  /** Example price against treated Southern pine = 1. */
  priceFactor: number;
}

export const FRAMING_SPECIES: readonly FramingSpecies[] = [
  { id: "southern-pine", label: "Southern pine, pressure-treated", short: "Treated Southern pine", group: "SP", treated: true, region: "East, South and Midwest", note: "The strongest of the treated framing species, and the one most yards east of the Rockies stock.", priceFactor: 1 },
  { id: "hem-fir", label: "Hem-fir, pressure-treated", short: "Treated hem-fir", group: "DF", treated: true, hemFir: true, region: "West", note: "The treated framing lumber of the Pacific Northwest, incised to take the preservative.", priceFactor: 1 },
  { id: "douglas-fir", label: "Douglas fir-larch, pressure-treated", short: "Treated Douglas fir", group: "DF", treated: true, region: "West", note: "Incised and treated; the code reads it on the same row as hem-fir.", priceFactor: 1.1 },
  { id: "spf", label: "Spruce-pine-fir, pressure-treated", short: "Treated SPF", group: "DF", treated: true, region: "Northern states", note: "Above ground only — it is not sold for ground contact, so posts and anything near the soil need another species.", priceFactor: 0.95 },
  { id: "ponderosa-pine", label: "Ponderosa pine, pressure-treated", short: "Treated ponderosa pine", group: "RW", treated: true, region: "Mountain West", note: "Read on the code's weakest row, with redwood and cedar: shorter spans for the same size.", priceFactor: 1 },
  { id: "red-pine", label: "Red pine, pressure-treated", short: "Treated red pine", group: "RW", treated: true, region: "Great Lakes and Northeast", note: "Read on the code's weakest row, with redwood and cedar: shorter spans for the same size.", priceFactor: 1 },
  { id: "redwood", label: "Redwood heartwood (not treated)", short: "Redwood heart", group: "RW", treated: false, region: "California and the West", note: "Naturally durable — heartwood only; sapwood rots. Shorter spans than treated fir.", priceFactor: 2.4 },
  { id: "western-cedar", label: "Western red cedar heartwood (not treated)", short: "Cedar heart", group: "RW", treated: false, region: "Northwest", note: "Naturally durable — heartwood only. Soft: the shortest spans, and it wants stainless or coated fasteners.", priceFactor: 2.1 },
];

export function framingSpecies(id: string | null | undefined): FramingSpecies {
  return FRAMING_SPECIES.find((s) => s.id === id) ?? FRAMING_SPECIES[0];
}

/** The treated lumber the state's yards stock (lib/deck/regional): Southern pine east of the Rockies, hem-fir in the
 *  West, Douglas fir in California and Hawaii. */
export function defaultFramingSpecies(state: string | null | undefined): FramingSpeciesId {
  return regionalPicks(state)?.framing ?? "southern-pine";
}

/* ------------------------------------------------------------------ */
/*  Decking                                                            */
/* ------------------------------------------------------------------ */

export type DeckingFamily = "treated" | "softwood" | "hardwood" | "modified" | "composite" | "pvc" | "mineral" | "aluminum";

export const DECKING_FAMILY_LABEL: Record<DeckingFamily, string> = {
  treated: "Pressure-treated wood",
  softwood: "Cedar, redwood and other softwoods",
  hardwood: "Hardwoods",
  modified: "Modified wood",
  composite: "Capped composite",
  pvc: "PVC",
  mineral: "Mineral-based composite",
  aluminum: "Aluminum",
};
export const DECKING_FAMILY_ORDER: readonly DeckingFamily[] = ["treated", "softwood", "hardwood", "modified", "composite", "pvc", "mineral", "aluminum"];

/** How a crew's time on the boards differs — the labor rate's key. */
export type DeckingLaborClass = "wood" | "hardwood" | "composite" | "pvc" | "aluminum";

/** The makers whose own lines are on the list (2026-10-12): the brands contractors buy most, in the order of their
 *  share of composite and PVC decking. Any other brand goes in as a custom board. */
export type DeckingBrand = "Trex" | "TimberTech" | "Fiberon" | "Deckorators" | "MoistureShield" | "Veranda" | "Envision" | "DuraLife" | "Wolf" | "NewTechWood" | "Lumberock" | "Cali" | "Armadillo";
export const DECKING_BRAND_ORDER: readonly DeckingBrand[] = ["Trex", "TimberTech", "Fiberon", "Deckorators", "MoistureShield", "Veranda", "Envision", "DuraLife", "Wolf", "NewTechWood", "Lumberock", "Cali", "Armadillo"];
export const DECKING_BRAND_LABEL: Record<DeckingBrand, string> = {
  Trex: "Trex",
  TimberTech: "TimberTech and AZEK",
  Fiberon: "Fiberon",
  Deckorators: "Deckorators",
  MoistureShield: "MoistureShield",
  Veranda: "Veranda (Home Depot)",
  Envision: "Envision",
  DuraLife: "DuraLife",
  Wolf: "Wolf Serenity",
  NewTechWood: "NewTechWood",
  Lumberock: "Lumberock",
  Cali: "Cali Bamboo",
  Armadillo: "Armadillo",
};

export interface DeckingProduct {
  id: string;
  label: string;
  family: DeckingFamily;
  /** A maker's own line; none for the generic boards ("Capped composite — mid line"). */
  brand?: DeckingBrand;
  /** As the yard sells it: "5/4x6", "2x6", "1x6". */
  nominal: string;
  /** Face width and thickness as it measures, inches. */
  widthIn: number;
  thickIn: number;
  /** Gap left between boards, inches. */
  gapIn: number;
  /** Widest joist spacing it may sit on: square to the joists, and at 45°. */
  maxSpacingIn: { square: number; diagonal: number };
  /** Where that spacing was read. */
  source: "code" | "maker" | "trade";
  sourceNote: string;
  /** Lengths the yard stocks, ft. */
  lengthsFt: readonly number[];
  /** Grooved edges exist, so hidden clips are a choice. */
  hiddenFasteners: boolean;
  /** The maker requires rows of solid blocking no farther apart than this, ft. */
  blockingRowsMaxFt?: number;
  /** The least open air the maker asks for under the joists, inches. */
  minClearanceIn?: number;
  /** The 3D's colour: the line's usual tone — or, on a built frame, the colour picked (lib/deck/deckingColors). */
  color: string;
  /** On a built frame: the picked colour's name, and the second tone of a streaked board. */
  colorName?: string;
  color2?: string;
  labor: DeckingLaborClass;
  /** What the market tables price it on (lib/fence/market). */
  basis: MarketBasis;
  /** EXAMPLE price per linear foot of board. */
  pricePerLf: number;
}

const WOOD_LENGTHS = [8, 10, 12, 14, 16] as const;
const LONG_WOOD_LENGTHS = [8, 10, 12, 14, 16, 20] as const;
const HARDWOOD_LENGTHS = [8, 10, 12, 14, 16, 18, 20] as const;
const COMPOSITE_LENGTHS = [12, 16, 20] as const;
const CODE_54 = "IRC Table R507.7 — 1 1/4-in. wood on three joists or more";
const CODE_2X = "IRC Table R507.7 — 2-in. wood";
const YARD = "The yard's usual span for this board — confirm it with your supplier";
const TREX = "Trex installation guide: 16 in. on center, 12 in. at 45°; air must move under the deck";
const TIMBERTECH = "TimberTech composite guide: 16 in., 12 in. at 45°; joists doubled at butt seams";
const AZEK = "TimberTech Advanced PVC guide: 16 in., 12 in. at 45°; solid blocking rows every 4–6 ft";
const FIBERON = "Fiberon guide: 16 in., 12 in. at 45°; 1½ in. of open air under the joists";
const VERANDA = "Veranda (made by Fiberon) guide: 16 in. on center, 12 in. at 45°; 1½ in. of open air under the joists";
const ENVISION = "Envision guide: 16 in. on center, 12 in. at 45° — compression-moulded, no cap to peel";
const DURALIFE = "DuraLife guide: 16 in. on center, 12 in. at 45° — a polypropylene core";
const WOLF = "Wolf Serenity (PVC) guide: 16 in. on center, 12 in. at 45°; solid blocking rows every 6 ft";
const NEWTECHWOOD = "NewTechWood guide: 16 in. on center, 12 in. at 45°";
const LUMBEROCK = "Lumberock guide: 16 in. on center, 12 in. at 45° — sold for docks and ground contact";
const CALI = "Cali Bamboo guide: 16 in. on center, 12 in. at 45°";
const ARMADILLO = "Armadillo guide: 16 in. on center, 12 in. at 45°";
const VISTA = "Deckorators Vista guide: 16 in., 12 in. at 45°; blocking every 4–6 ft, 2 in. of air under the joists";
const SURESTONE = "Deckorators Surestone guide: 16 in., 12 in. at 45°; rated for ground contact";
const MOISTURESHIELD = "MoistureShield guide: 16 in., 12 in. at 45°; rated for ground and water contact";

const wood54 = { nominal: "5/4x6", widthIn: 5.5, thickIn: 1, gapIn: 0.125, maxSpacingIn: { square: 16, diagonal: 12 }, source: "code", sourceNote: CODE_54, hiddenFasteners: false } as const;
const wood2x6 = { nominal: "2x6", widthIn: 5.5, thickIn: 1.5, gapIn: 0.125, maxSpacingIn: { square: 24, diagonal: 24 }, source: "code", sourceNote: CODE_2X, hiddenFasteners: false } as const;
const hard1x6 = { nominal: "1x6", widthIn: 5.5, thickIn: 0.75, gapIn: 0.1875, maxSpacingIn: { square: 16, diagonal: 12 }, source: "trade", sourceNote: YARD, hiddenFasteners: true, lengthsFt: HARDWOOD_LENGTHS, labor: "hardwood", basis: "vinyl" } as const;
const hard54 = { nominal: "5/4x6", widthIn: 5.5, thickIn: 1, gapIn: 0.1875, maxSpacingIn: { square: 24, diagonal: 16 }, source: "trade", sourceNote: YARD, hiddenFasteners: true, lengthsFt: HARDWOOD_LENGTHS, labor: "hardwood", basis: "vinyl" } as const;
const capped = { nominal: "1x6", widthIn: 5.5, thickIn: 1, gapIn: 0.1875, hiddenFasteners: true, lengthsFt: COMPOSITE_LENGTHS, basis: "vinyl" } as const;

export const DECKING: readonly DeckingProduct[] = [
  // Pressure-treated
  { id: "pt-pine-54", label: "Treated Southern pine 5/4x6", family: "treated", ...wood54, lengthsFt: WOOD_LENGTHS, color: "#a58a5c", labor: "wood", basis: "pine", pricePerLf: 1.15 },
  { id: "pt-pine-2x6", label: "Treated Southern pine 2x6", family: "treated", ...wood2x6, lengthsFt: LONG_WOOD_LENGTHS, color: "#a58a5c", labor: "wood", basis: "pine", pricePerLf: 1.1 },
  { id: "pt-hemfir-2x6", label: "Treated hem-fir / Douglas fir 2x6", family: "treated", ...wood2x6, lengthsFt: LONG_WOOD_LENGTHS, color: "#9a8257", labor: "wood", basis: "vinyl", pricePerLf: 1.2 },
  { id: "pt-hemfir-54", label: "Treated hem-fir 5/4x6", family: "treated", ...wood54, lengthsFt: WOOD_LENGTHS, color: "#9a8257", labor: "wood", basis: "vinyl", pricePerLf: 1.25 },
  { id: "pt-kdat-54", label: "Kiln-dried treated pine (KDAT) 5/4x6", family: "treated", ...wood54, lengthsFt: WOOD_LENGTHS, color: "#b39565", labor: "wood", basis: "pine", pricePerLf: 1.75 },
  // Naturally durable softwoods
  { id: "cedar-54", label: "Western red cedar 5/4x6", family: "softwood", ...wood54, lengthsFt: WOOD_LENGTHS, color: "#b5764a", labor: "wood", basis: "cedar", pricePerLf: 2.6 },
  { id: "cedar-2x6", label: "Western red cedar 2x6", family: "softwood", ...wood2x6, lengthsFt: LONG_WOOD_LENGTHS, color: "#b5764a", labor: "wood", basis: "cedar", pricePerLf: 3.2 },
  { id: "redwood-2x6", label: "Redwood 2x6 (heart)", family: "softwood", ...wood2x6, lengthsFt: LONG_WOOD_LENGTHS, color: "#a4573e", labor: "wood", basis: "cedar", pricePerLf: 4.2 },
  { id: "redwood-54", label: "Redwood 5/4x6 (heart)", family: "softwood", ...wood54, lengthsFt: WOOD_LENGTHS, color: "#a4573e", labor: "wood", basis: "cedar", pricePerLf: 3.6 },
  { id: "yellow-cedar-2x6", label: "Alaskan yellow cedar 2x6", family: "softwood", ...wood2x6, lengthsFt: WOOD_LENGTHS, color: "#d2b877", labor: "wood", basis: "cedar", pricePerLf: 4 },
  { id: "cypress-54", label: "Cypress 5/4x6", family: "softwood", ...wood54, lengthsFt: WOOD_LENGTHS, color: "#c49a62", labor: "wood", basis: "pine", pricePerLf: 2.4 },
  // Hardwoods
  { id: "ipe-1x6", label: "Ipe 1x6", family: "hardwood", ...hard1x6, color: "#5b3a26", pricePerLf: 6 },
  { id: "ipe-54", label: "Ipe 5/4x6", family: "hardwood", ...hard54, color: "#5b3a26", pricePerLf: 8.5 },
  { id: "cumaru-1x6", label: "Cumaru 1x6", family: "hardwood", ...hard1x6, color: "#7a4a2a", pricePerLf: 5 },
  { id: "tigerwood-1x6", label: "Tigerwood 1x6", family: "hardwood", ...hard1x6, color: "#9a5a2c", pricePerLf: 5.5 },
  { id: "garapa-1x6", label: "Garapa 1x6", family: "hardwood", ...hard1x6, color: "#c79a56", pricePerLf: 4.5 },
  { id: "massaranduba-1x6", label: "Massaranduba 1x6", family: "hardwood", ...hard1x6, color: "#7c3626", pricePerLf: 5.5 },
  { id: "mahogany-54", label: "Mahogany (meranti / red balau) 5/4x6", family: "hardwood", ...hard54, maxSpacingIn: { square: 16, diagonal: 12 }, color: "#8a4a34", pricePerLf: 4 },
  { id: "black-locust-54", label: "Black locust 5/4x6", family: "hardwood", ...hard54, maxSpacingIn: { square: 16, diagonal: 12 }, lengthsFt: WOOD_LENGTHS, color: "#b79a57", pricePerLf: 6.5 },
  { id: "bamboo-1x6", label: "Fused bamboo 1x6", family: "hardwood", ...hard1x6, color: "#6b4a30", pricePerLf: 5.5 },
  // Modified wood
  { id: "thermo-ash-54", label: "Thermally modified ash 5/4x6", family: "modified", ...hard54, maxSpacingIn: { square: 16, diagonal: 12 }, lengthsFt: WOOD_LENGTHS, color: "#6f4b33", pricePerLf: 6.5 },
  { id: "thermo-pine-54", label: "Thermally modified pine 5/4x6", family: "modified", ...hard54, maxSpacingIn: { square: 16, diagonal: 12 }, lengthsFt: WOOD_LENGTHS, color: "#8a6642", labor: "wood", pricePerLf: 3.8 },
  { id: "accoya-54", label: "Acetylated pine (Accoya) 5/4x6", family: "modified", ...hard54, maxSpacingIn: { square: 16, diagonal: 12 }, lengthsFt: WOOD_LENGTHS, color: "#cfb88a", labor: "wood", pricePerLf: 7.5 },
  { id: "kebony-54", label: "Kebony 5/4x6", family: "modified", ...hard54, maxSpacingIn: { square: 16, diagonal: 12 }, lengthsFt: WOOD_LENGTHS, color: "#5e4433", labor: "wood", pricePerLf: 8 },
  // Capped composite — by tier; a shop's own brand line goes in its price book
  { id: "composite-good", label: "Capped composite — value line", family: "composite", ...capped, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: "Trex, TimberTech and Fiberon guides: 16 in. square to the joists, 12 in. at 45°", minClearanceIn: 1.5, color: "#8c6f57", labor: "composite", pricePerLf: 3.2 },
  { id: "composite-better", label: "Capped composite — mid line", family: "composite", ...capped, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: "Trex, TimberTech and Fiberon guides: 16 in. square to the joists, 12 in. at 45°", minClearanceIn: 1.5, color: "#6f5a4b", labor: "composite", pricePerLf: 4.5 },
  { id: "composite-best", label: "Capped composite — premium line", family: "composite", ...capped, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: "Trex, TimberTech and Fiberon guides: 16 in. square to the joists, 12 in. at 45°", minClearanceIn: 1.5, color: "#5a4a40", labor: "composite", pricePerLf: 6 },
  // PVC
  { id: "pvc", label: "Capped PVC", family: "pvc", ...capped, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: "TimberTech Advanced PVC guide: 16 in., 12 in. for angled boards, solid blocking rows every 4–6 ft", blockingRowsMaxFt: 6, minClearanceIn: 1.5, color: "#8f8377", labor: "pvc", pricePerLf: 6.5 },
  // Mineral-based
  { id: "mineral", label: "Mineral-based composite", family: "mineral", ...capped, maxSpacingIn: { square: 16, diagonal: 12 }, source: "trade", sourceNote: "The usual 16 in. — check this maker's guide", color: "#7b756c", labor: "composite", pricePerLf: 6.5 },
  // Aluminum
  { id: "aluminum", label: "Aluminum plank", family: "aluminum", nominal: "1x6", widthIn: 6, thickIn: 1, gapIn: 0, maxSpacingIn: { square: 24, diagonal: 16 }, source: "trade", sourceNote: "The usual 24 in. — check this maker's guide", lengthsFt: [12, 16, 20, 24], hiddenFasteners: true, color: "#a9adb0", labor: "aluminum", basis: "metal", pricePerLf: 9 },
  // ── THE BRANDS' OWN LINES (2026-10-12): the lines contractors buy most, with each maker's spacing and air rules from
  // its installation guide. Every one sits on joists 16 in. apart, 12 in. on a 45° board. The example price is the
  // board's listed price per foot (Home Depot's where it sells it — lib/deck/storePrices — else a dealer's or Lowe's).
  // Trex — about half of composite decking; Enhance Naturals is Home Depot's best-selling board.
  { id: "trex-enhance-basics", label: "Trex Enhance Basics", brand: "Trex", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: TREX, color: "#8a6a4c", labor: "composite", pricePerLf: 2 },
  { id: "trex-enhance-naturals", label: "Trex Enhance Naturals", brand: "Trex", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: TREX, color: "#7b746a", labor: "composite", pricePerLf: 2.6 },
  { id: "trex-select", label: "Trex Select", brand: "Trex", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.82, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: TREX, color: "#9a968f", labor: "composite", pricePerLf: 5 },
  { id: "trex-transcend", label: "Trex Transcend", brand: "Trex", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: TREX, color: "#7a4b36", labor: "composite", pricePerLf: 6.31 },
  { id: "trex-transcend-lineage", label: "Trex Transcend Lineage", brand: "Trex", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: TREX, color: "#6a5848", labor: "composite", pricePerLf: 6.31 },
  // TimberTech (composite) and its AZEK PVC — the second brand, about a quarter of the market.
  { id: "timbertech-prime", label: "TimberTech Prime", brand: "TimberTech", family: "composite", ...capped, widthIn: 5.36, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: TIMBERTECH, minClearanceIn: 1.5, color: "#6b4e3a", labor: "composite", pricePerLf: 3.32 },
  { id: "timbertech-prime-plus", label: "TimberTech Prime+", brand: "TimberTech", family: "composite", ...capped, widthIn: 5.36, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: TIMBERTECH, minClearanceIn: 1.5, color: "#8c6b50", labor: "composite", pricePerLf: 3.19 },
  { id: "timbertech-reserve", label: "TimberTech PRO Reserve", brand: "TimberTech", family: "composite", ...capped, widthIn: 5.36, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: TIMBERTECH, minClearanceIn: 1.5, color: "#4f3b2f", labor: "composite", pricePerLf: 5.89 },
  { id: "timbertech-azek-harvest", label: "TimberTech AZEK Harvest (PVC)", brand: "TimberTech", family: "pvc", ...capped, widthIn: 5.5, thickIn: 1, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: AZEK, blockingRowsMaxFt: 6, minClearanceIn: 1.5, color: "#79593f", labor: "pvc", pricePerLf: 5.13 },
  { id: "timbertech-azek-vintage", label: "TimberTech AZEK Vintage (PVC)", brand: "TimberTech", family: "pvc", ...capped, widthIn: 5.5, thickIn: 1, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: AZEK, blockingRowsMaxFt: 6, minClearanceIn: 1.5, color: "#9e7a55", labor: "pvc", pricePerLf: 5.27 },
  { id: "timbertech-azek-landmark", label: "TimberTech AZEK Landmark (PVC)", brand: "TimberTech", family: "pvc", ...capped, widthIn: 5.5, thickIn: 1, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: AZEK, blockingRowsMaxFt: 6, minClearanceIn: 1.5, color: "#5c4434", labor: "pvc", pricePerLf: 7.63 },
  // Fiberon — the third brand; ArmorGuard is sold only at Home Depot (a best seller there).
  { id: "fiberon-armorguard", label: "Fiberon ArmorGuard", brand: "Fiberon", family: "composite", ...capped, widthIn: 5.2, thickIn: 0.92, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: FIBERON, minClearanceIn: 1.5, color: "#8a867f", labor: "composite", pricePerLf: 2.25 },
  { id: "fiberon-good-life", label: "Fiberon Good Life", brand: "Fiberon", family: "composite", ...capped, widthIn: 5.4, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: FIBERON, minClearanceIn: 1.5, color: "#6f5440", labor: "composite", pricePerLf: 2.97 },
  { id: "fiberon-sanctuary", label: "Fiberon Sanctuary", brand: "Fiberon", family: "composite", ...capped, widthIn: 5.4, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: FIBERON, minClearanceIn: 1.5, color: "#8e6d50", labor: "composite", pricePerLf: 5.2 },
  { id: "fiberon-concordia", label: "Fiberon Concordia", brand: "Fiberon", family: "composite", ...capped, widthIn: 5.4, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: FIBERON, minClearanceIn: 1.5, color: "#4a4845", labor: "composite", pricePerLf: 6.27 },
  { id: "fiberon-paramount", label: "Fiberon Paramount (PVC)", brand: "Fiberon", family: "pvc", ...capped, widthIn: 5.5, thickIn: 1, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: FIBERON, minClearanceIn: 1.5, color: "#b39c7e", labor: "pvc", pricePerLf: 4.12 },
  // Deckorators (UFP): Vista is wood composite; Summit and Voyage are its mineral-based Surestone boards.
  { id: "deckorators-summit", label: "Deckorators Summit (mineral-based)", brand: "Deckorators", family: "mineral", ...capped, widthIn: 5.5, thickIn: 0.875, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: SURESTONE, color: "#7c6551", labor: "composite", pricePerLf: 2.5 },
  { id: "deckorators-vista", label: "Deckorators Vista", brand: "Deckorators", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.875, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: VISTA, blockingRowsMaxFt: 6, minClearanceIn: 2, color: "#5b4636", labor: "composite", pricePerLf: 5.41 },
  { id: "deckorators-voyage", label: "Deckorators Voyage (mineral-based)", brand: "Deckorators", family: "mineral", ...capped, widthIn: 5.5, thickIn: 0.875, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: SURESTONE, color: "#8b5b40", labor: "composite", pricePerLf: 7.63 },
  // MoistureShield — rated for ground and water contact.
  { id: "moistureshield-vision", label: "MoistureShield Vision", brand: "MoistureShield", family: "composite", ...capped, widthIn: 5.4, thickIn: 1, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: MOISTURESHIELD, color: "#4b3a2f", labor: "composite", pricePerLf: 5.72 },
  // THE OTHER MAKERS CONTRACTORS ASK FOR (2026-10-24 — owner: "add Trex, artificial materials, TimberTech and other most
  // popular ones"): the box-store house brand, the compression-moulded and polypropylene-core composites, the PVC and
  // mineral boards sold for docks, the bamboo composite. One or two lines each; the rest go in as a custom board.
  { id: "veranda-composite", label: "Veranda Composite (Home Depot)", brand: "Veranda", family: "composite", ...capped, widthIn: 5.25, thickIn: 0.9, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: VERANDA, minClearanceIn: 1.5, color: "#6b5a4a", labor: "composite", pricePerLf: 2.9 },
  { id: "envision-distinction", label: "Envision Distinction", brand: "Envision", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: ENVISION, color: "#5a4639", labor: "composite", pricePerLf: 5.6 },
  { id: "envision-expression", label: "Envision Expression", brand: "Envision", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: ENVISION, color: "#7a5d47", labor: "composite", pricePerLf: 4.5 },
  { id: "duralife-landscapes", label: "DuraLife Landscapes", brand: "DuraLife", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: DURALIFE, color: "#8a6a4e", labor: "composite", pricePerLf: 4.7 },
  { id: "wolf-serenity", label: "Wolf Serenity (PVC)", brand: "Wolf", family: "pvc", ...capped, widthIn: 5.5, thickIn: 1, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: WOLF, blockingRowsMaxFt: 6, color: "#a08a70", labor: "pvc", pricePerLf: 6.3 },
  { id: "newtechwood-ultrashield", label: "NewTechWood UltraShield Naturale", brand: "NewTechWood", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: NEWTECHWOOD, color: "#6d5341", labor: "composite", pricePerLf: 4.9 },
  { id: "lumberock-mineral", label: "Lumberock (mineral-based)", brand: "Lumberock", family: "mineral", ...capped, widthIn: 5.5, thickIn: 1, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: LUMBEROCK, color: "#8b7a66", labor: "composite", pricePerLf: 6.1 },
  { id: "calibamboo-truorganics", label: "Cali Bamboo TruOrganics", brand: "Cali", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: CALI, color: "#5c4a3a", labor: "composite", pricePerLf: 5.9 },
  { id: "armadillo-expression", label: "Armadillo Expression", brand: "Armadillo", family: "composite", ...capped, widthIn: 5.5, thickIn: 0.94, maxSpacingIn: { square: 16, diagonal: 12 }, source: "maker", sourceNote: ARMADILLO, color: "#7b6350", labor: "composite", pricePerLf: 4.6 },
];

export function deckingProduct(id: string | null | undefined): DeckingProduct {
  return DECKING.find((d) => d.id === id) ?? DECKING[0];
}

/** The board a new deck starts on (lib/deck/regional): the region's treated board — 5/4 pine in the East, a treated
 *  2x6 in the Mountain states and Alaska — and capped composite on the Pacific coast and in Hawaii, where treated
 *  decking is a small share of what is built. */
export function defaultDecking(state: string | null | undefined): string {
  return regionalPicks(state)?.defaultBoard ?? "pt-pine-54";
}

/** The region's treated deck board: the Good tier. */
export function treatedDecking(state: string | null | undefined): string {
  return regionalPicks(state)?.treatedBoard ?? "pt-pine-54";
}

/* ------------------------------------------------------------------ */
/*  The wall the deck meets                                            */
/* ------------------------------------------------------------------ */

export type WallTypeId = "wood-rim" | "engineered-rim" | "foam-sheathing" | "concrete" | "brick-veneer" | "hollow-block" | "cantilever" | "open-truss" | "sip-icf" | "unknown";

export interface WallType {
  id: WallTypeId;
  label: string;
  /** May a ledger carry the deck on this wall? */
  ledger: boolean;
  /** The fasteners that have a table for this wall, the default first. */
  fasteners: readonly LedgerFastener[];
  /** What the fastener tables call the house's rim. */
  rim: "lumber" | "engineered";
  /** May the deck be TIED to the house against sideways movement even when it stands on its own posts? */
  lateralTie: boolean;
  why: string;
}

export const WALL_TYPES: readonly WallType[] = [
  { id: "wood-rim", label: "Wood frame — 2x lumber rim", ledger: true, fasteners: ["lag", "bolt", "ledgerlok", "sdws"], rim: "lumber", lateralTie: true, why: "A solid 2x rim joist on the foundation takes a ledger: siding off, flashing on, fasteners by the table." },
  { id: "engineered-rim", label: "Wood frame — engineered rim board (I-joist floor)", ledger: true, fasteners: ["lag", "bolt", "ledgerlok", "sdws"], rim: "engineered", lateralTie: true, why: "A 1-in. or thicker engineered rim takes a ledger, with the fasteners closer together. The rim maker's own detail governs." },
  { id: "foam-sheathing", label: "Wood frame — foam or gypsum sheathing, up to 1 in.", ledger: true, fasteners: ["bolt-gap"], rim: "lumber", lateralTie: true, why: "With foam or gypsum between ledger and rim, only through-bolts have a column in the code's table." },
  { id: "concrete", label: "Poured concrete or solid masonry", ledger: true, fasteners: ["anchor"], rim: "lumber", lateralTie: true, why: "A ledger goes on with 1/2-in. expansion or adhesive anchors, spaced by the anchor maker. Lead anchors are not allowed." },
  { id: "brick-veneer", label: "Brick or stone veneer", ledger: false, fasteners: [], rim: "lumber", lateralTie: false, why: "The code bars hanging a deck on masonry veneer: it is a skin, not a wall. The deck stands on its own posts beside the house." },
  { id: "hollow-block", label: "Hollow concrete block", ledger: false, fasteners: [], rim: "lumber", lateralTie: false, why: "AWC's guide bars a ledger on hollow masonry. The deck stands on its own posts." },
  { id: "cantilever", label: "Overhanging floor or bay window", ledger: false, fasteners: [], rim: "lumber", lateralTie: false, why: "A floor that overhangs its foundation cannot carry a deck. The deck stands on its own posts." },
  { id: "open-truss", label: "Floor trusses with a 2x4 ribbon", ledger: false, fasteners: [], rim: "lumber", lateralTie: false, why: "A 2x4 ribbon across truss ends is not a rim joist. Without the truss designer's detail, the deck stands on its own posts." },
  { id: "sip-icf", label: "SIP, ICF or EIFS wall", ledger: false, fasteners: [], rim: "lumber", lateralTie: false, why: "No printed table covers a ledger on these walls. The deck stands on its own posts, or an engineer details the connection." },
  { id: "unknown", label: "Can't see the framing", ledger: false, fasteners: [], rim: "lumber", lateralTie: false, why: "Where the connection to the house cannot be checked, the code wants the deck self-supporting." },
];

export function wallType(id: string | null | undefined): WallType {
  return WALL_TYPES.find((w) => w.id === id) ?? WALL_TYPES[0];
}

/* ------------------------------------------------------------------ */
/*  Railing — an allowance until the rail builder lands                */
/* ------------------------------------------------------------------ */

export type RailTypeId = "none" | "treated" | "cedar" | "composite" | "vinyl" | "aluminum" | "cable" | "glass" | "custom";

export interface RailType {
  id: RailTypeId;
  label: string;
  /** EXAMPLE installed price per linear foot: [material, labor]. */
  perFt: readonly [number, number];
  basis: MarketBasis;
}

export const RAIL_TYPES: readonly RailType[] = [
  { id: "none", label: "No railing in this price", perFt: [0, 0], basis: "pine" },
  { id: "treated", label: "Pressure-treated wood", perFt: [16, 22], basis: "pine" },
  { id: "cedar", label: "Cedar", perFt: [28, 24], basis: "cedar" },
  { id: "composite", label: "Composite", perFt: [52, 28], basis: "vinyl" },
  { id: "vinyl", label: "Vinyl", perFt: [38, 24], basis: "vinyl" },
  { id: "aluminum", label: "Aluminum", perFt: [62, 26], basis: "metal" },
  { id: "cable", label: "Cable", perFt: [115, 45], basis: "metal" },
  { id: "glass", label: "Glass panels", perFt: [150, 55], basis: "metal" },
  { id: "custom", label: "Custom — your price", perFt: [0, 0], basis: "metal" },
];

export function railType(id: string | null | undefined): RailType {
  return RAIL_TYPES.find((r) => r.id === id) ?? RAIL_TYPES[0];
}

/**
 * THE COLOURS A RAILING SYSTEM IS STOCKED IN (2026-11-09 — owner: "check the railings, the styles and colors … whatever
 * the client sees, he gets"). Read from the makers' railing pages and brochures that month: each is the colour by the
 * name contractors use, the first one the system's usual — what the 3D draws until another is picked.
 *
 * A COMPOSITE rail is NOT sold in the deck board's colour: Trex, TimberTech and Fiberon sell rails and post sleeves in
 * white, black and one or two browns only (the 3D used to draw a composite rail the colour of the boards — a rail
 * nobody can buy). Wood rails are the wood; a custom system takes the common metal colours.
 */
export interface RailColor {
  id: string;
  name: string;
  hex: string;
  /** Whose colour it is, for the hint under the list. */
  like: string;
}
const RAIL_BLACK: RailColor = { id: "black", name: "Textured black", hex: "#1f1f1e", like: "Westbury Black Fine Texture, Trex Signature Charcoal Black, Fortress Black Sand" };
const RAIL_BRONZE: RailColor = { id: "bronze", name: "Bronze", hex: "#4d4435", like: "Westbury Bronze Fine Texture, Trex Signature Bronze, TimberTech Dark Bronze" };
const RAIL_WHITE: RailColor = { id: "white", name: "White", hex: "#f0efea", like: "Westbury White Fine Texture, Trex Classic White, Fortress Matte White" };
export const RAIL_COLORS: Readonly<Partial<Record<RailTypeId, readonly RailColor[]>>> = {
  aluminum: [RAIL_BLACK, RAIL_BRONZE, RAIL_WHITE, { id: "grey", name: "Grey", hex: "#6e6e6e", like: "Westbury Grey Fine Texture, Feeney Dove Gray" }, { id: "oil-bronze", name: "Oil-rubbed bronze", hex: "#3a362b", like: "Key-Link Oil Rubbed Bronze, Westbury Ninety Bronze" }],
  composite: [
    { id: "white", name: "White", hex: "#f2f0ec", like: "Trex Classic White, TimberTech White, Fiberon Tranquil White" },
    { id: "black", name: "Black", hex: "#242021", like: "Trex Charcoal Black, TimberTech Matte Black, Fiberon Serene Black" },
    { id: "brown", name: "Dark brown", hex: "#483a2f", like: "TimberTech Matte Espresso, Fiberon Simply Brown" },
    { id: "red-bronze", name: "Reddish bronze", hex: "#4a2420", like: "Trex Vintage Lantern" },
  ],
  vinyl: [
    { id: "white", name: "White", hex: "#fbfbf8", like: "Weatherables, Durables and RDI White" },
    { id: "tan", name: "Tan", hex: "#ded0b5", like: "Weatherables Tan, Durables Tan, RDI Sand" },
    { id: "khaki", name: "Khaki", hex: "#b5ae9e", like: "Weatherables Khaki, Durables Khaki, RDI Clay" },
  ],
  cable: [RAIL_BLACK, RAIL_BRONZE, RAIL_WHITE, { id: "silver", name: "Silver", hex: "#a8a9a1", like: "Feeney Silver, Westbury Grey Fine Texture" }],
  glass: [RAIL_BLACK, RAIL_WHITE, RAIL_BRONZE],
  custom: [RAIL_BLACK, RAIL_BRONZE, RAIL_WHITE, { id: "brown", name: "Dark brown", hex: "#483a2f", like: "a dark brown powder coat or cap stock" }],
};
/** The colours of a system ([] for wood: it is the wood). */
export function railColors(type: RailTypeId | string | null | undefined): readonly RailColor[] {
  return RAIL_COLORS[type as RailTypeId] ?? [];
}
/** The picked colour, or the system's usual one; null for a wood rail. */
export function railColorOf(type: RailTypeId | string | null | undefined, id: string | null | undefined): RailColor | null {
  const list = railColors(type);
  return list.find((c) => c.id === id) ?? list[0] ?? null;
}
/** Stainless cable, and the black of a metal baluster, a rod or a wire mesh in a rail of another colour. */
export const RAIL_STAINLESS = "#b9bcc0";
export const RAIL_METAL_BLACK = "#1f1f1e";
