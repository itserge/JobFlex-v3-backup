// THE COLOURS EACH BOARD LINE IS SOLD IN (2026-11-09) — pure data.
//
// Owner: "add the exact colors that exist for this brand and type of the
// materials, and when we select any of those colors it should appear on the
// 3D design as well — whatever gets designed and the client sees, he gets."
//
// For every maker's line on the decking list (lib/deck/catalog): the colours
// the maker sells it in, under the maker's own names, read from the maker's
// colour pages in November 2026 (the page is beside each line). The NAME is
// what the proposal and the material list print, so the yard pulls the board
// the client saw. The hex is the board's main tone for the 3D — sampled from
// the maker's own swatch picture, never a paint code; a streaked board
// carries its second tone too, and the 3D lays the boards in both.
//
// Only colours on the maker's page when it was read are here. One that had
// left the page but still stood in a yard (Trex Transcend "Rope Swing", Trex
// Enhance Naturals "Coastal Bluff") is NOT: a contractor who can still get it
// types it in as a colour of his own (design.decking.ownColor), as he does a
// stain on a wood board.
//
// Makers retire and rename colours every season: `DECKING_COLORS_READ` says
// when this list was read.

import type { DeckingProduct } from "./catalog";

export interface BoardColor {
  /** Stable within its line: the name in lower case, dashed. */
  id: string;
  /** As the maker writes it. */
  name: string;
  /** The board's main tone in the 3D. */
  hex: string;
  /** The second tone of a streaked (variegated) board. */
  hex2?: string;
  /** The maker's own grouping inside the line ("Weekender", "Escapes"). */
  group?: string;
}

/** When the makers' pages were read. */
export const DECKING_COLORS_READ = "November 2026";

const c = (name: string, hex: string, hex2?: string, group?: string): BoardColor => ({
  id: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
  name,
  hex,
  ...(hex2 ? { hex2 } : {}),
  ...(group ? { group } : {}),
});

/** By the decking product's id. A line that is not here has no list: the contractor types the colour. */
export const DECKING_COLORS: Readonly<Record<string, readonly BoardColor[]>> = {
  /* COLOURS:BEGIN */
  // Trex Enhance Basics — https://www.trex.com/products/decking/enhance/
  "trex-enhance-basics": [c("Saddle", "#856650"), c("Clam Shell", "#6c6a64"), c("Tide Pool", "#8e847a"), c("Pebble Beach", "#a09c9b")],
  // Trex Enhance Naturals — https://www.trex.com/products/decking/enhance/
  "trex-enhance-naturals": [c("Foggy Wharf", "#b7b9b5", "#a0a3a1"), c("Rocky Harbor", "#a49b90", "#91887f"), c("Toasted Sand", "#92755b", "#7b634d"), c("Honey Grove", "#a38e72", "#8d7a62"), c("Cinnamon Cove", "#856252", "#6d4c3e"), c("Golden Hour", "#bd9471", "#987860")],
  // Trex Select — https://www.trex.com/products/decking/select/
  "trex-select": [c("Whiskey Barrel", "#856959", "#6c5142"), c("Malted Barley", "#c2b2a5", "#ad9b8f"), c("Millstone", "#928f8d", "#7b7777"), c("Pebble Grey", "#8d8583"), c("Saddle", "#8b5e40")],
  // Trex Transcend — https://www.trex.com/products/decking/transcend/
  "trex-transcend": [c("Island Mist", "#958481", "#70615f"), c("Tiki Torch", "#c76f44", "#9f4e2a"), c("Havana Gold", "#a26b46", "#7e4e30"), c("Spiced Rum", "#8f553e", "#673728"), c("Lava Rock", "#843c36", "#541f1c")],
  // Trex Transcend Lineage — https://www.trex.com/products/decking/lineage/
  "trex-transcend-lineage": [c("Island Mist", "#8c897e", "#77746a"), c("Biscayne", "#a79a89", "#908678"), c("Rainier", "#b0afab", "#a0a09e"), c("Carmel", "#ccb49a", "#b89e84"), c("Jasper", "#a08167", "#83644d"), c("Hatteras", "#845b4b", "#724e40"), c("Salt Flat", "#c7b7aa", "#baab9f")],
  // TimberTech Composite Prime Collection — https://www.timbertech.com/product/edge-prime-collection/
  "timbertech-prime": [c("Maritime Gray", "#6a6e69"), c("Dark Teak", "#6b4d44")],
  // TimberTech Composite Prime+ Collection — https://www.timbertech.com/product/edge-prime-plus-collection/
  "timbertech-prime-plus": [c("Coconut Husk", "#9b7750", "#8b6948"), c("Sea Salt Gray", "#747871", "#676a64"), c("Dark Cocoa", "#6a5b4f", "#5b4e43")],
  // TimberTech Composite Reserve Collection — https://www.timbertech.com/product/pro-reserve-collection/
  "timbertech-reserve": [c("Antique Leather", "#8a6a48", "#7a5e41"), c("Driftwood", "#7d7771", "#6f6b66"), c("Dark Roast", "#5f4b3b", "#534233"), c("Reclaimed Chestnut", "#d6cdb9", "#c9bfac")],
  // TimberTech Advanced PVC Harvest Collection — https://www.timbertech.com/product/azek-harvest-collection/
  "timbertech-azek-harvest": [c("Slate Gray", "#ab9d92"), c("Brownstone", "#a3866d"), c("Kona", "#4d362f")],
  // TimberTech Advanced PVC Vintage Collection — https://www.timbertech.com/product/azek-vintage-collection/
  "timbertech-azek-vintage": [c("Coastline", "#8b8178", "#80766e"), c("Mahogany", "#795644", "#6c4c3b"), c("Weathered Teak", "#aa8a65", "#9c7d5b"), c("English Walnut", "#675042", "#5c483a"), c("Dark Hickory", "#50463f", "#5b5049"), c("Cypress", "#84593d", "#946546")],
  // TimberTech Advanced PVC Landmark Collection — https://www.timbertech.com/product/azek-landmark-collection/
  "timbertech-azek-landmark": [c("French White Oak", "#b9a996", "#ab9987"), c("Castle Gate", "#656362", "#72706d"), c("American Walnut", "#604d41", "#554338"), c("Boardwalk", "#d3d1ca", "#c8c7c0")],
  // Fiberon ArmorGuard (The Home Depot exclusive) — https://www.fiberondecking.com/products/armorguard-designers-choice-decking
  "fiberon-armorguard": [c("Forest Brown", "#6e5949", "#625041", "Designer's Choice"), c("Coastal Gray", "#908881", "#817972", "Designer's Choice"), c("Honey Brown", "#b3a187", "#a49479", "Pro Fire-Resistant"), c("Cool Gray", "#bdbcb6", "#8f8e89", "Pro Fire-Resistant")],
  // Fiberon Good Life — https://www.fiberondecking.com/products/good-life-decking
  "fiberon-good-life": [c("Cottage", "#9f9794", undefined, "Weekender"), c("Cabin", "#886145", undefined, "Weekender"), c("Beach House", "#6d6f71", "#838587", "Escapes"), c("Cabana", "#958a83", "#827772", "Escapes"), c("Tuscan Villa", "#8d6a4d", "#7f5c42", "Escapes"), c("Bungalow", "#7b5640", "#91684f", "Escapes")],
  // Fiberon Sanctuary — https://www.fiberondecking.com/products/sanctuary-decking
  "fiberon-sanctuary": [c("Moringa", "#906745", "#a37c5a"), c("Latte", "#4d4c49", "#69615a"), c("Earl Grey", "#363a41", "#46494e"), c("Chai", "#aba9a4", "#999690"), c("Espresso", "#443022", "#553f2e")],
  // Fiberon Concordia — https://www.fiberondecking.com/products/concordia-decking
  "fiberon-concordia": [c("Ipe", "#815438", "#9a6a4a", "Horizon"), c("Castle Gray", "#9ca3a9", "#7d868f", "Horizon"), c("Graphite", "#605953", "#524c47", "Symmetry"), c("Burnt Umber", "#452e22", "#523527", "Symmetry"), c("Warm Sienna", "#755237", "#644732", "Symmetry"), c("Prairie Wheat", "#c3a98e", "#a68e74", "Astir"), c("Mountain Ash", "#63503e", "#755e4b", "Astir"), c("Seaside Mist", "#8c867d", "#79736b", "Astir")],
  // Fiberon Paramount PVC — https://www.fiberondecking.com/products/paramount-decking
  "fiberon-paramount": [c("Brownstone", "#967960", "#7c624c", "Hearth"), c("Sandstone", "#7a7369", "#8c8479", "Hearth"), c("Clay", "#937756", undefined, "Mantel"), c("Mineral", "#91918f", undefined, "Mantel")],
  // Deckorators Summit (Surestone mineral-based) — https://www.deckorators.com/products/summit-decking
  "deckorators-summit": [c("Glacier", "#948d7e", "#847d70"), c("Boulder", "#836950", "#755b43"), c("Cliffside", "#ae9a7e", "#9d8b71")],
  // Deckorators Vista — https://www.deckorators.com/products/vista-decking
  "deckorators-vista": [c("Dunewood", "#8c7560", "#7d6955"), c("Driftwood", "#585656", "#4d4c4d"), c("Ironwood", "#4d433b", "#60544d"), c("Silverwood", "#8d8e8a", "#7a7b79")],
  // Deckorators Voyage (Surestone mineral-based) — https://www.deckorators.com/products/voyage-decking
  "deckorators-voyage": [c("Costa", "#947d66", "#7e6c5d"), c("Sierra", "#646363", "#595859"), c("Khaya", "#5f4a3c", "#564336"), c("Tundra", "#959290", "#7a797b"), c("Sedona", "#8d623f", "#7a5538"), c("Mesa", "#835f49", "#725443")],
  // MoistureShield Vision — https://www.moistureshield.com/products/composite-decking/vision/
  "moistureshield-vision": [c("Smokey Gray", "#5b5450", "#83786e"), c("Spanish Leather", "#4d3e32", "#574638"), c("Sandstone", "#6d604c", "#897961"), c("Cathedral Stone", "#74685c", "#8a7e6d"), c("Mochaccino", "#a58e6c", "#b7a07f"), c("Cold Brew", "#6d583f", "#776047")],
  // Envision Distinction — https://envisionoutdoorliving.com/our-products/composite-decking/envision-distinction/
  "envision-distinction": [c("Rustic Walnut", "#564338", "#715548"), c("Shaded Auburn", "#785549", "#886053"), c("Spiced Teak", "#906748", "#9f7353"), c("Grey Wood", "#6f6d6d", "#827e7d"), c("Rockaway Beach", "#8c7158", "#775c45", "Cool Tread"), c("Hampton Dunes", "#be997d", "#a68164", "Cool Tread"), c("Nantucket Shore", "#988d88", "#8b817d", "Cool Tread"), c("Seaside Pier", "#b29e92", "#9f8c82", "Cool Tread")],
  // Envision Expression — https://envisionoutdoorliving.com/our-products/composite-decking/envision-expression/
  "envision-expression": [c("Caribou Brown", "#6a5140"), c("Harbor Grey", "#6d6969")],
  // Wolf Serenity Decking (PVC) — https://www.wolfhomeproducts.com/decking-porch/serenity-decking/
  "wolf-serenity": [c("Amberwood", "#b2906f", "#a38264", "Tropical Hardwoods"), c("Ashland", "#807671", "#746a65", "Tropical Hardwoods"), c("Beechwood", "#c5a98f", "#b59a82", "Tropical Hardwoods"), c("Black Walnut", "#625c56", "#716a62", "Tropical Hardwoods"), c("Driftwood Grey", "#919598", "#898d90", "Tropical Hardwoods"), c("Golden Cypress", "#d2b086", "#c5a47d", "Tropical Hardwoods"), c("Onyx", "#5d5952", "#56524a", "Tropical Hardwoods"), c("Rosewood", "#917164", "#82665d", "Tropical Hardwoods"), c("Silver Teak", "#aea698", "#9f988f", "Tropical Hardwoods"), c("Weathered Ipe", "#948374", "#89796a", "Tropical Hardwoods"), c("Harbor Grey", "#b3b1a8", undefined, "Seaside"), c("Sand Castle", "#beaf97", undefined, "Seaside")],
  // NewTechWood UltraShield Naturale (Explorer Series: Magellan / Cortes) — https://www.newtechwood.com/colors/
  "newtechwood-ultrashield": [c("Leather Brown", "#6f533b", undefined, "In stock, 8 ft and 16 ft"), c("Castle Gray", "#736662", "#6a5d58", "In stock, 8 ft and 16 ft"), c("Indian Ebony", "#292627", "#201f1f", "In stock, 8 ft and 16 ft"), c("Argentinian Silver Gray", "#7b7875", "#6c6866", "In stock, 8 ft and 16 ft"), c("Roman Antique", "#b3a998", "#a49988", "In stock, 8 ft and 16 ft"), c("Brazilian Ipe", "#6a4f3f", "#7b5f4f", "In stock, 8 ft and 16 ft"), c("Spanish Walnut", "#4d3c32", "#5a4a40", "In stock, 8 ft and 16 ft"), c("Peruvian Teak", "#997151", "#866041", "In stock, 8 ft and 16 ft"), c("Seoul Pink", "#c2828e", undefined, "In stock, 8 ft only"), c("Japanese Cedar", "#d6c7a4", "#cfc19e", "In stock, 8 ft only"), c("Australian Red Cedar", "#a07348", "#93663b", "In stock, 8 ft only"), c("Floridian Orange", "#c78335", "#b77329", "In stock, 8 ft only"), c("Honduran Mahogany", "#7e5b41", "#6e4b32", "In stock, 8 ft only"), c("Swedish Red", "#83362f", "#8f413a", "In stock, 8 ft only"), c("Caribbean Blue", "#77b7c2", "#64a8b6", "In stock, 8 ft only"), c("Irish Green", "#abb06b", "#999f5b", "In stock, 8 ft only"), c("Icelandic Smoke White", "#c5c5c5", "#b8b7b7", "In stock, 8 ft only"), c("Canadian Maple", "#b49072", "#a58164", "Custom order, about 6 months"), c("Indonesian Merbau", "#453e36", "#564f46", "Custom order, about 6 months"), c("English Oak", "#9c7d4b", "#aa8b59", "Custom order, about 6 months"), c("California Redwood", "#6b483a", "#7b594b", "Custom order, about 6 months"), c("Sahara Sand", "#dad1aa", "#cfc69d", "Custom order, about 6 months")],
  // Lumberock mineral-filled HDPE decking — https://www.lumberock.com/coastal-collection/
  "lumberock-mineral": [c("Gray", "#b0b1b1", undefined, "Classic Collection"), c("Putty", "#dac7a3", undefined, "Classic Collection"), c("Anchor Gray", "#605b55", undefined, "Classic Collection"), c("Weathered Wood", "#a38d79", undefined, "Classic Collection"), c("Redwood", "#934e3b", undefined, "Classic Collection"), c("Green", "#5d6d5e", undefined, "Classic Collection"), c("White", "#e7e7e6", undefined, "Classic Collection"), c("Harborwood", "#a89985", undefined, "Classic Collection"), c("Cedar", "#d59466", undefined, "Classic Collection"), c("Tan", "#d1ab79", undefined, "Classic Collection"), c("Chocolate Brown", "#674f41", undefined, "Classic Collection"), c("Black", "#3b3a38", undefined, "Classic Collection"), c("Lighthouse", "#e7e7e7", undefined, "Coastal Collection"), c("Ashwood", "#dadada", undefined, "Coastal Collection"), c("Riverstone", "#b8b8b8", undefined, "Coastal Collection"), c("Sandbar", "#e0d8ca", undefined, "Coastal Collection"), c("Driftwood", "#b29c87", undefined, "Coastal Collection"), c("Boardwalk", "#88715a", undefined, "Coastal Collection"), c("Pewter", "#535353", undefined, "Coastal Collection"), c("Canyon Brown", "#938070", "#867363", "Genesis Collection"), c("Smokey Gray", "#a8a6a2", "#93908c", "Genesis Collection")],
  // CALI (Cali Bamboo) TruOrganics composite decking — https://www.califloors.com/composite-decking/planks/products
  "calibamboo-truorganics": [c("Denali", "#937264", "#806357"), c("Yosemite", "#6c6a6d", "#79777a"), c("Glacier", "#c2c1c8", "#adabb4"), c("Sedona", "#90624a", "#9c6e56")],
  // Armadillo composite decking (Evolution + Essential series) — https://armadillodeck.com/armadillo-composite-decking/
  "armadillo-expression": [c("Bourbon", "#412c23", "#563f35", "Evolution Series"), c("Firewood", "#9f6849", "#7b4c33", "Evolution Series"), c("Linen", "#dddacf", "#c7c3b8", "Evolution Series"), c("Silverstone", "#c1c6c9", "#a0a5a9", "Evolution Series"), c("Mesa", "#8d5140", "#703d2e", "Evolution Series"), c("Steel Wool", "#8c8c8c", "#6f6f6f", "Evolution Series"), c("Twilight", "#867573", "#6a5c5a", "Evolution Series"), c("Sand Storm", "#c6b5a9", "#a29286", "Evolution Series"), c("Dovetail", "#c7cbce", "#9da1a5", "Essential Series"), c("Saw Grass", "#c7b7aa", "#9b8e85", "Essential Series"), c("Saloon", "#463026", "#5d4438", "Essential Series"), c("Thunder", "#8a8d94", "#6c6f76", "Essential Series")],
  // Owens Corning Marine Grade decking — the colours The Deck Store sells it in, Nov 2026 (swatches sampled):
  // https://deckstore.com/collections/owens-corning
  "oc-marine-54x6": [c("Gobi", "#b2a095"), c("Saddlestone", "#a37f6c"), c("Mink", "#c7b8aa"), c("Stratus", "#bab9b7"), c("Sanddollar", "#ded3c7"), c("Shale", "#d5d4d3")],
  "oc-marine-2x6": [c("Gobi", "#b2a095"), c("Saddlestone", "#a37f6c"), c("Mink", "#c7b8aa"), c("Stratus", "#bab9b7"), c("Sanddollar", "#ded3c7"), c("Shale", "#d5d4d3")],
  /* COLOURS:END */
};

/** The colours a line is sold in ([] for a generic board or a wood). */
export function deckingColors(productId: string | null | undefined): readonly BoardColor[] {
  return (productId && DECKING_COLORS[productId]) || [];
}

export function deckingColor(productId: string | null | undefined, colorId: string | null | undefined): BoardColor | null {
  if (!colorId) return null;
  return deckingColors(productId).find((x) => x.id === colorId) ?? null;
}

/** What the design's boards are called and how they look: the contractor's own colour first, then the line's, then the line's usual tone. */
export function deckingLook(product: Pick<DeckingProduct, "id" | "color">, decking: { color: string; ownColor: { name: string; hex: string } | null }): { name: string | null; hex: string; hex2: string | null } {
  if (decking.ownColor) return { name: decking.ownColor.name, hex: decking.ownColor.hex, hex2: null };
  const picked = deckingColor(product.id, decking.color);
  if (picked) return { name: picked.name, hex: picked.hex, hex2: picked.hex2 ?? null };
  return { name: null, hex: product.color, hex2: null };
}

/** "Trex Transcend Lineage in Jasper" — the board as the order names it. */
export function deckingNamed(label: string, colorName: string | null): string {
  return colorName ? `${label} in ${colorName}` : label;
}
