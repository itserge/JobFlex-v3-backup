import "server-only";
// WEBSITE ESTIMATORS · THE FOUR ENGINES (2026-10-27): what a homeowner is asked on the contractor's website for each
// trade, the choices they pick from, and the price — in the shop's own prices (its roof catalog and brand rates, its
// HVAC rate card and catalog, its fence rates, its deck rate book), with the trade's defaults where the shop set none.
// Nothing here orders a paid report: the roof is measured from Google's aerial data (cents a lookup), the HVAC load
// is sized from what the homeowner types (no parcel lookups — those draw on a lifetime quota), the fence from the
// feet they measure, the deck from the design they pick. The public page (app/(portal)/estimate) and the action
// (actions/webEstimator) call runWebTrade; the pure rules are lib/webEstimator.
import { db } from "@/lib/db";
import { geocodePlace } from "@/lib/maps";
import { SolarUnavailableError, getBuildingInsights } from "@/lib/solar";
import { estimateSolarRoof, type SolarRoofEstimate } from "@/lib/roofSolarEstimate";
import { BUILTIN_LISTS, ROOF_FAMILIES, familyLabel, likeForLikeSystem, type CatalogLists, type RoofFamily, type RoofSystem } from "@/lib/roofPackage/catalog";
import { rankBrandsFor, withBrand, withBrandPrice, type BrandRate } from "@/lib/roofPackage/brands";
import { buildRoofPackage, defaultSpec, withSystem, type RoofFacts } from "@/lib/roofPackage/takeoff";
import { roofCatalogSchema } from "@/lib/roofPackage/catalogSchema";
import { modelFromSite, applyStatedNested, type SiteFacts as HvacSiteFacts } from "@/lib/hvac/intake";
import { designConditionsFor } from "@/lib/hvac/designConditions";
import { runEngine } from "@/lib/hvac/engine";
import { DEFAULT_RATE_CARD, normalizeRateCard, tiersFor, type HvacRateCard } from "@/lib/hvac/ledger";
import { US_CATALOG } from "@/lib/hvac/data/usCatalog";
import { TIER_LABEL } from "@/lib/hvac/catalogView";
import type { CatalogItem } from "@/lib/hvac/types";
import { FENCE_TYPES, fenceType, type FenceTypeId } from "@/lib/fence/catalog";
import { priceFencePackage, type FencePriceOptions, type CustomFenceType } from "@/lib/fence/pricing";
import { typedRuns } from "@/lib/fence/layout";
import { resolveMarket } from "@/lib/fence/market";
import { fenceCatalogSchema } from "@/lib/fence/catalogSchema";
import { sanitizeRateBook } from "@/lib/fence/rates";
import { priceDeck } from "@/lib/deck/pricing";
import { defaultDeckDesign, structureWords, type DeckDesign } from "@/lib/deck/design";
import { applyDeckPatch } from "@/lib/deck/checks";
import { settleDesign } from "@/lib/deck/settle";
import { DECK_SAMPLES, sampleById, sampleDesign } from "@/lib/deck/samples";
import { DECKING, RAIL_TYPES, defaultDecking } from "@/lib/deck/catalog";
import { siteFromAddress } from "@/lib/deck/site";
import { readDeckRateBook } from "@/lib/deck/rateBookStore";
import type { WebTrade } from "./webEstimator";
import type { WebShop } from "./webEstimatorServer";

/** The homeowner's address as the page sends it (Places, or typed). */
export interface WebAddress { address: string; city: string; state: string; zip: string; lat?: number | null; lng?: number | null }

/** One thing the homeowner picks from (a material, a style, a tier, a layout). */
export interface WebChoice { id: string; label: string; note?: string }

/** What a trade asks beyond the address; the page draws these. */
export interface WebQuestion { id: string; label: string; kind: "number" | "select"; unit?: string; min?: number; max?: number; step?: number; options?: WebChoice[]; help?: string; required?: boolean; default?: number | string }

export interface WebTradeInput { address: WebAddress; choice: string | null; answers: Record<string, string | number> }

export type WebTradeOutcome =
  | { ok: true; summary: string; choice: string; cents: number; city: string | null; state: string | null; zip: string | null; facts: Record<string, unknown> }
  | { ok: false; error: string; code: "no-coverage" | "address" | "input" | "unavailable" };

const n = (v: unknown, fallback: number): number => { const x = Number(v); return Number.isFinite(x) ? x : fallback; };
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dollars = (d: number) => "$" + Math.round(d).toLocaleString("en-US");

// ── the choices and questions the page shows, per trade

const ROOF_SYSTEM_FOR: Record<RoofFamily, string> = { asphalt: "architectural", metal: "standing_seam", tile: "concrete_tile", shake: "cedar_shake", slate: "slate", synthetic: "synthetic_slate", "low-slope": "tpo" };
const ROOF_CHOICE_NOTE: Record<RoofFamily, string> = { asphalt: "Architectural shingles — the most common roof", metal: "Standing-seam panels", tile: "Concrete tile", shake: "Cedar shakes", slate: "Natural slate", synthetic: "Synthetic slate", "low-slope": "TPO membrane for a flat or low-slope roof" };

export function webTradeChoices(shop: WebShop, trade: WebTrade): WebChoice[] {
  const picked = new Set(shop.settings.trades[trade].materials);
  const keep = (c: WebChoice) => !picked.size || picked.has(c.id);
  switch (trade) {
    case "smart": return [];
    case "roof":
      return ROOF_FAMILIES.filter((f) => f.id !== "low-slope" || picked.has("low-slope")).map((f) => ({ id: f.id, label: f.label, note: ROOF_CHOICE_NOTE[f.id] })).filter(keep);
    case "hvac":
      return [
        { id: "ac-furnace", label: "Air conditioner + gas furnace", note: "The usual split system" },
        { id: "heat-pump", label: "Heat pump", note: "Heats and cools, all electric" },
      ].filter(keep);
    case "fence":
      return FENCE_TYPES.map((t) => ({ id: t.id, label: t.label })).filter(keep);
    case "deck":
      return DECK_SAMPLES.map((s) => ({ id: s.id, label: s.name, note: s.facts })).filter(keep);
  }
}

/** A roof under 2/12 is a flat roof (2026-11-01): shingles, tile, shakes and slate need a slope to shed water, so a
 *  flat roof is offered — and priced — as a membrane only, the dashboard's low-slope package. */
export const FLAT_ROOF_PITCH12 = 2;
export const isFlatRoof = (pitch12: number | null | undefined): boolean => typeof pitch12 === "number" && Number.isFinite(pitch12) && pitch12 < FLAT_ROOF_PITCH12;

/** The materials the roof step offers once the roof is measured: a flat roof gets the membrane alone. */
export function webRoofChoices(shop: WebShop, pitch12: number | null | undefined): WebChoice[] {
  if (isFlatRoof(pitch12)) return ROOF_FAMILIES.filter((f) => f.id === "low-slope").map((f) => ({ id: f.id, label: f.label, note: ROOF_CHOICE_NOTE[f.id] }));
  return webTradeChoices(shop, "roof").filter((c) => c.id !== "low-slope");
}

/** Everything a shop could offer for a trade (the settings pane's picker). */
export function webTradeAllChoices(trade: WebTrade): WebChoice[] {
  switch (trade) {
    case "smart": return [];
    case "roof": return ROOF_FAMILIES.map((f) => ({ id: f.id, label: f.label, note: ROOF_CHOICE_NOTE[f.id] }));
    case "hvac": return [{ id: "ac-furnace", label: "Air conditioner + gas furnace" }, { id: "heat-pump", label: "Heat pump" }];
    case "fence": return FENCE_TYPES.map((t) => ({ id: t.id, label: t.label }));
    case "deck": return DECK_SAMPLES.map((s) => ({ id: s.id, label: s.name, note: s.facts }));
  }
}

const DECK_BOARDS: WebChoice[] = [
  { id: "pt-pine-54", label: "Pressure-treated pine", note: "The budget board" },
  { id: "cedar-54", label: "Cedar" },
  { id: "composite-good", label: "Composite — good" },
  { id: "composite-better", label: "Composite — better" },
  { id: "composite-best", label: "Composite — best" },
];
const DECK_RAILS: WebChoice[] = RAIL_TYPES.filter((r) => ["treated", "cedar", "composite", "aluminum", "cable", "none"].includes(r.id)).map((r) => ({ id: r.id, label: r.label }));
const DECK_HEIGHTS: WebChoice[] = [{ id: "14", label: "Near the ground (about a foot)" }, { id: "24", label: "Two steps up (2 ft)" }, { id: "36", label: "First floor (3 ft)" }, { id: "96", label: "Walk-out (8 ft)" }];

export function webTradeQuestions(trade: WebTrade): WebQuestion[] {
  switch (trade) {
    case "smart": return [];
    case "roof":
      return [];
    case "hvac":
      return [
        { id: "sqft", label: "Heated square feet", kind: "number", unit: "sq ft", min: 400, max: 8000, step: 50, required: true, help: "The living space the system heats and cools. A guess within a few hundred feet is fine." },
        { id: "storeys", label: "Storeys", kind: "select", options: [{ id: "1", label: "One storey" }, { id: "2", label: "Two storeys" }, { id: "3", label: "Three or more" }], default: "1" },
        { id: "year", label: "Year built", kind: "select", options: [{ id: "1960", label: "Before 1970" }, { id: "1980", label: "1970s – 80s" }, { id: "1995", label: "1990s" }, { id: "2005", label: "2000s" }, { id: "2015", label: "2010s" }, { id: "2022", label: "2020 or newer" }], default: "1995" },
        { id: "existing", label: "What is there now", kind: "select", options: [{ id: "split-ac-furnace", label: "Air conditioner + furnace" }, { id: "split-heat-pump", label: "Heat pump" }, { id: "furnace-only", label: "Furnace only" }, { id: "none", label: "Nothing yet" }], default: "split-ac-furnace" },
        { id: "gas", label: "Natural gas at the house", kind: "select", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], default: "yes" },
      ];
    case "fence":
      return [
        { id: "feet", label: "Feet of fence", kind: "number", unit: "ft", min: 20, max: 2000, step: 5, required: true, help: "Measure along the lines you want fenced. A quarter-acre lot's side and back lines run about 250 ft." },
        { id: "height", label: "Height", kind: "select", options: [{ id: "4", label: "4 ft" }, { id: "5", label: "5 ft" }, { id: "6", label: "6 ft" }, { id: "8", label: "8 ft" }], default: "6" },
        { id: "gates", label: "Walk gates", kind: "number", min: 0, max: 6, step: 1, default: 1 },
        { id: "double", label: "Double (drive) gates", kind: "number", min: 0, max: 3, step: 1, default: 0 },
      ];
    case "deck":
      return [
        { id: "width", label: "Along the house", kind: "number", unit: "ft", min: 8, max: 40, step: 1, default: 16, required: true },
        { id: "depth", label: "Out from the house", kind: "number", unit: "ft", min: 6, max: 30, step: 1, default: 12, required: true },
        { id: "height", label: "How high off the ground", kind: "select", options: DECK_HEIGHTS, default: "36" },
        { id: "boards", label: "Boards", kind: "select", options: DECK_BOARDS, default: "composite-better" },
        { id: "rail", label: "Railing", kind: "select", options: DECK_RAILS, default: "composite" },
      ];
  }
}

// ── the engines

export async function runWebTrade(shop: WebShop, trade: WebTrade, input: WebTradeInput): Promise<WebTradeOutcome> {
  const a = input.address;
  if (!a || typeof a.address !== "string" || a.address.trim().length < 5) return { ok: false, error: "Type the address of the house.", code: "address" };
  switch (trade) {
    case "roof": return roofEstimate(shop, input);
    case "hvac": return hvacEstimate(shop, input);
    case "fence": return fenceEstimate(shop, input);
    case "deck": return deckEstimate(shop, input);
    case "smart": return { ok: false, error: "Describe the project on the page.", code: "input" };
  }
}

const parts = (a: WebAddress) => ({ city: a.city?.trim() || null, state: (a.state?.trim() || "").toUpperCase() || null, zip: a.zip?.trim() || null });
const fullAddress = (a: WebAddress) => [a.address, a.city, a.state, a.zip].map((s) => (s || "").trim()).filter(Boolean).join(", ");

/** The pin: Places gave one, else Google's geocoder (never throws; null when the address is unknown). */
async function pinFor(a: WebAddress): Promise<{ lat: number; lng: number; county?: string; state?: string; city?: string; zip?: string } | null> {
  if (typeof a.lat === "number" && typeof a.lng === "number" && Number.isFinite(a.lat) && Number.isFinite(a.lng)) return { lat: a.lat, lng: a.lng };
  const g = await geocodePlace(fullAddress(a)).catch(() => null);
  return g ? { lat: g.lat, lng: g.lng, county: g.county ?? undefined, state: g.state ?? undefined, city: g.city ?? undefined, zip: g.zip ?? undefined } : null;
}

// ROOF — Google's aerial model of the roof → the shop's package for the family the homeowner picked

export interface RoofBook { lists: CatalogLists; brandRates: Record<string, BrandRate> | null; brands: Record<string, string | null> | null; lowSlope: string | null }
export async function roofBook(organizationId: string): Promise<RoofBook> {
  const none: RoofBook = { lists: BUILTIN_LISTS, brandRates: null, brands: null, lowSlope: null };
  try {
    const row = await db.roofCatalog.findUnique({ where: { organizationId } });
    if (!row) return none;
    const parsed = roofCatalogSchema.safeParse(JSON.parse(row.catalogJson));
    if (!parsed.success) return none;
    const doc = parsed.data;
    const prefs = (doc.prefs ?? {}) as { brandRates?: Record<string, BrandRate>; brands?: Record<string, string | null>; lowSlopeSystemId?: string | null };
    const lists: CatalogLists = doc.systems.length ? { systems: doc.systems as RoofSystem[], underlayments: doc.underlayments.length ? (doc.underlayments as CatalogLists["underlayments"]) : BUILTIN_LISTS.underlayments } : BUILTIN_LISTS;
    return { lists, brandRates: prefs.brandRates ?? null, brands: prefs.brands ?? null, lowSlope: prefs.lowSlopeSystemId ?? null };
  } catch {
    return none;
  }
}

function roofFacts(est: SolarRoofEstimate, state: string | null): RoofFacts {
  const total = est.pitchFamilies.reduce((s, f) => s + f.surfaceSqft, 0) || 1;
  return {
    squares: est.areaSqft / 100, squaresBasis: "estimated",
    pitchFamilies: est.pitchFamilies.map((f) => ({ pitch12: f.pitch12, share: f.surfaceSqft / total })), pitchBasis: "estimated",
    perimeterFt: null, footprintSqft: est.footprintSqft, chimney: null, rooftopAcCount: null, shape: null, facetCount: null,
    measured: null, existingMaterial: null, state, facetCountEstimated: est.segmentCount, storeys: null,
  };
}

/** THE ROOF MEASURED FROM THE AIR, kept apart from the pricing (2026-10-28): the website measures once, shows it on
 *  the house, and prices each material the homeowner tries from that one measurement. */
export interface WebRoofMeasure { est: SolarRoofEstimate; pin: NonNullable<Awaited<ReturnType<typeof pinFor>>>; parts: ReturnType<typeof parts>; address: WebAddress }
export type WebRoofMeasureResult = { ok: true; measure: WebRoofMeasure } | Extract<WebTradeOutcome, { ok: false }> | { ok: false; error: string; code: "pin"; pin: { lat: number; lng: number } };

export async function measureWebRoof(shop: WebShop, a: WebAddress): Promise<WebRoofMeasureResult> {
  void shop;
  const p = parts(a);
  const pin = await pinFor(a);
  if (!pin) return { ok: false, error: "We couldn't find that address. Check the street and the city.", code: "address" };
  // HIGH imagery first; where Google has none, MEDIUM — many US homes have nothing better, and the homeowner's rough
  // range does not need the contractor's precision (the homeowner portal's rule, actions/publicEstimate, 2026-10-28).
  // The second call is made only on "no coverage at HIGH".
  const NONE = { ok: false as const, error: "We couldn't measure this roof from the air. Leave your details and we'll measure it in person.", code: "no-coverage" as const };
  for (const quality of ["HIGH", "MEDIUM"] as const) {
    try {
      const insights = await getBuildingInsights(pin.lat, pin.lng, quality);
      const r = estimateSolarRoof(insights, pin, undefined, { minQuality: "MEDIUM" });
      // The building Google found is not under the pin (a geocode on the street): the homeowner moves the pin onto the
      // roof and measures again — the address step keeps them, with the map.
      if (!r.ok && /match the pin|location is missing/i.test(r.error)) return { ok: false, error: "We found a building near that address, but not under the pin. Drag the pin onto your roof, then measure again.", code: "pin", pin: { lat: pin.lat, lng: pin.lng } };
      if (!r.ok) return NONE;
      return { ok: true, measure: { est: r.estimate, pin, parts: p, address: a } };
    } catch (err) {
      if (!(err instanceof SolarUnavailableError && err.kind === "no-coverage")) return { ok: false, error: "The aerial measurement isn't answering right now. Leave your details and we'll measure it.", code: "unavailable" };
    }
  }
  return NONE;
}

const pkgLine = (l: { name: string; quantity: number; unit: string; unitPrice: number; basis?: unknown }) => ({ name: l.name, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, basis: l.basis ?? null });

/** The measured roof in the family the homeowner picked, priced in the shop's book (its systems, brands, rates). */
export async function priceWebRoof(shop: WebShop, m: WebRoofMeasure, pick: string | null): Promise<WebTradeOutcome> {
  const { est, pin, parts: p } = m;
  // A flat roof is priced as a membrane whatever was asked; a sloped one never is.
  const family = (isFlatRoof(est.predominantPitch12) ? "low-slope" : ROOF_FAMILIES.find((f) => f.id === pick && f.id !== "low-slope")?.id ?? "asphalt") as RoofFamily;
  const state = p.state || pin.state?.toUpperCase() || shop.state;
  const facts = roofFacts(est, state);
  const book = await roofBook(shop.id);
  const sys = book.lists.systems.find((s) => s.id === ROOF_SYSTEM_FOR[family]) ?? likeForLikeSystem(family, book.lists) ?? book.lists.systems[0];
  if (!sys) return { ok: false, error: "This shop has no roof system to price yet.", code: "unavailable" };
  const base = withSystem(defaultSpec(facts, book.lists, book.lowSlope), sys, facts, book.lists);
  const ranked = rankBrandsFor(sys.id, family, state);
  const live = withBrandPrice(withBrand(base, ranked, book.brands?.[sys.id] ?? null), book.brandRates);
  const pkg = buildRoofPackage(live, facts);
  const total = [...pkg.materials, ...pkg.labor].reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const squares = Math.round(facts.squares);
  const brand = (live as { productName?: string }).productName;
  const choice = brand ? `${brand} (${familyLabel(family).toLowerCase()})` : `${familyLabel(family)} — ${sys.label}`;
  const summary = `Your roof measures about ${squares} squares (${Math.round(est.areaSqft).toLocaleString("en-US")} sq ft) at a ${est.pitchLabel} pitch, ${est.segmentCount} roof planes, from aerial imagery${est.imageryDate ? ` of ${est.imageryDate.slice(0, 4)}` : ""}.`;
  return {
    ok: true, summary, choice, cents: Math.round(total * 100), ...p,
    facts: { pin, areaSqft: est.areaSqft, squares: facts.squares, pitchLabel: est.pitchLabel, pitchFamilies: est.pitchFamilies, segmentCount: est.segmentCount, imageryDate: est.imageryDate, imageryQuality: est.imageryQuality, family, systemId: sys.id, product: brand ?? null, solar: est,
      // The package as priced — its choices and its lines — so the lead opens in the roof estimator on the same number
      // (lib/webHandoff roofSeedFromWebLead).
      spec: live, lines: { materials: pkg.materials.map(pkgLine), labor: pkg.labor.map(pkgLine), scope: pkg.scope, assumptions: pkg.assumptions } },
  };
}

async function roofEstimate(shop: WebShop, input: WebTradeInput): Promise<WebTradeOutcome> {
  const m = await measureWebRoof(shop, input.address);
  // the one-shot path has no map to move a pin on: a building off the pin is "no read" there
  if (!m.ok) return m.code === "pin" ? { ok: false, error: m.error, code: "no-coverage" } : m;
  return priceWebRoof(shop, m.measure, input.choice);
}

/** "June 2025" from the imagery's date, whatever shape Solar gave it. */
export function imageryWords(d: unknown): string | null {
  if (typeof d === "string" && d) { const t = Date.parse(d.length === 7 ? `${d}-01` : d); return Number.isNaN(t) ? d : new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
  if (d && typeof d === "object" && typeof (d as { year?: unknown }).year === "number") { const o = d as { year: number; month?: number }; return o.month ? new Date(o.year, o.month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : String(o.year); }
  return null;
}

// HVAC — the homeowner's answers → a Manual J-style load → the shop's tiers, the chosen one priced

export async function hvacBook(organizationId: string): Promise<{ card: HvacRateCard; catalog: CatalogItem[] }> {
  let catalog: CatalogItem[] = US_CATALOG, card: HvacRateCard = DEFAULT_RATE_CARD;
  try {
    const rows = await db.hvacCatalogItem.findMany({ where: { organizationId } });
    if (rows.length) catalog = rows.map((r) => JSON.parse(r.itemJson) as CatalogItem);
  } catch { /* the US catalog stands */ }
  try {
    const row = await db.hvacSettings.findUnique({ where: { organizationId } });
    if (row) card = normalizeRateCard(JSON.parse(row.rateCardJson));
  } catch { /* the default card stands */ }
  return { card, catalog };
}

/** HVAC ON THE WEBSITE (2026-10-28): the house looked up (lib/hvac/siteLookup), the homeowner's answers, then the
 *  load and EVERY tier priced in the shop's book — the homeowner picks one. The old one-shot path (runWebTrade) takes
 *  the middle tier. */
export interface WebHvacTier { tier: "value" | "mid" | "premium"; label: string; unit: string; cents: number; summary: string; choice: string; facts: Record<string, unknown> }
export interface WebHvacSized {
  ok: true;
  load: { heatingBtuh: number; coolingTotalBtuh: number; coolingTons: number };
  design: { heatingF: number; coolingF: number; county: string };
  outdoorKind: "heat-pump" | "air-conditioner";
  tiers: WebHvacTier[];
  city: string | null;
  state: string | null;
  zip: string | null;
}

export async function sizeWebHvac(shop: WebShop, site: HvacSiteFacts, p: { city: string | null; state: string | null; zip: string | null }, ans: Record<string, string | number>, pick: string | null): Promise<WebHvacSized | Extract<WebTradeOutcome, { ok: false }>> {
  const sqft = site.livingSqft ?? 0;
  if (!sqft || sqft < 400) return { ok: false, error: "How many square feet does the system heat and cool?", code: "input" };
  const model = modelFromSite(site);
  const existing = String(ans.existing || "split-ac-furnace");
  applyStatedNested(model, "existing.kind", ["split-ac-furnace", "split-heat-pump", "furnace-only", "none"].includes(existing) ? existing : "split-ac-furnace");
  applyStatedNested(model, "gas.available", String(ans.gas || "yes") !== "no");
  const outdoorKind = pick === "heat-pump" ? "heat-pump" : "air-conditioner";
  const { card, catalog } = await hvacBook(shop.id);
  const { conditions } = designConditionsFor(site.state, site.county, site.elevationFt ?? 0);
  const job = "replace-system" as const;
  const engine = runEngine(model, { conditions, catalog, job, outdoorKind });
  const tiers = tiersFor(engine, model, card, catalog, { job }, (id) => runEngine(model, { catalog, job, outdoorKind, pick: id, conditions }));
  if (!tiers.length) return { ok: false, error: "We couldn't size a system from those answers. Leave your details and we'll size it in person.", code: "unavailable" };
  const tons = engine.load.coolingTons;
  const load = { heatingBtuh: engine.load.heatingBtuh, coolingTotalBtuh: engine.load.coolingTotalBtuh, coolingTons: tons };
  const summary = `A ${tons.toFixed(1)}-ton system for ${sqft.toLocaleString("en-US")} sq ft: about ${Math.round(engine.load.heatingBtuh).toLocaleString("en-US")} BTU/h of heating and ${Math.round(engine.load.coolingTotalBtuh).toLocaleString("en-US")} of cooling on the design day.`;
  const kindWords = outdoorKind === "heat-pump" ? "Heat pump" : "Air conditioner + furnace";
  const all = tiers.map((t) => ({ tier: t.tier, label: TIER_LABEL[t.tier], unit: `${t.candidate.item.brand} ${t.candidate.item.model}`, subtotal: t.subtotal }));
  const pin = site.lat !== undefined && site.lng !== undefined ? { lat: site.lat, lng: site.lng } : null;
  return {
    ok: true, load, design: { heatingF: conditions.heatingF, coolingF: conditions.coolingF, county: conditions.county }, outdoorKind, ...p,
    tiers: tiers.map((t) => ({
      tier: t.tier, label: TIER_LABEL[t.tier], unit: `${t.candidate.item.brand} ${t.candidate.item.model}`, cents: Math.round(t.subtotal * 100), summary,
      choice: `${kindWords}, the ${TIER_LABEL[t.tier].toLowerCase()} tier (${t.candidate.item.brand} ${t.candidate.item.model})`,
      // `site` and `itemId` (2026-10-28, lib/webHandoff): the house as confirmed and the unit itself, so the lead opens
      // in the shop's HVAC estimator on the design step with this tier picked.
      facts: { site, itemId: t.candidate.item.id, sqft, storeys: site.storeys, yearBuilt: site.yearBuilt, existing, gas: String(ans.gas || "yes"), outdoorKind, county: site.county ?? null, load, tiers: all, tier: t.tier, pin, lookedUp: Object.keys(site.sources ?? {}).length > 0, footprintSqft: site.footprintSqft ?? null, elevationFt: site.elevationFt ?? null },
    })),
  };
}

async function hvacEstimate(shop: WebShop, input: WebTradeInput): Promise<WebTradeOutcome> {
  const a = input.address, p = parts(a), ans = input.answers ?? {};
  const sqft = clampN(n(ans.sqft, 0), 400, 8000);
  if (!sqft || n(ans.sqft, 0) < 400) return { ok: false, error: "How many square feet does the system heat and cool?", code: "input" };
  const pin = await pinFor(a);
  const state = p.state || pin?.state?.toUpperCase() || shop.state;
  if (!state) return { ok: false, error: "Which state is the house in?", code: "address" };
  const site: HvacSiteFacts = { address: fullAddress(a), state, county: pin?.county, lat: pin?.lat, lng: pin?.lng, livingSqft: sqft, storeys: clampN(n(ans.storeys, 1), 1, 3), yearBuilt: clampN(n(ans.year, 1995), 1850, 2030), sources: {} };
  const r = await sizeWebHvac(shop, site, p, ans, input.choice);
  if (!r.ok) return r;
  const mid = r.tiers.find((t) => t.tier === "mid") ?? r.tiers[1] ?? r.tiers[0];
  return { ok: true, summary: mid.summary, choice: mid.choice, cents: mid.cents, ...p, facts: mid.facts };
}

// FENCE — the feet they measure, the style and height, the gates → the shop's rates in this market

async function fenceBook(organizationId: string, address: string): Promise<FencePriceOptions & { wastePct?: number }> {
  const market = resolveMarket({ address });
  try {
    const row = await db.fenceCatalog.findUnique({ where: { organizationId } });
    if (!row) return { market };
    const parsed = fenceCatalogSchema.safeParse(JSON.parse(row.catalogJson));
    if (!parsed.success) return { market };
    const doc = parsed.data;
    return { market, rates: sanitizeRateBook(doc.rates), customs: doc.custom as CustomFenceType[], removalPerLf: doc.removalPerLf, wastePct: doc.wastePct };
  } catch {
    return { market };
  }
}

async function fenceEstimate(shop: WebShop, input: WebTradeInput): Promise<WebTradeOutcome> {
  const a = input.address, p = parts(a), ans = input.answers ?? {};
  const feet = clampN(n(ans.feet, 0), 20, 2000);
  if (n(ans.feet, 0) < 20) return { ok: false, error: "How many feet of fence? Measure along the lines you want fenced.", code: "input" };
  const type = (FENCE_TYPES.find((t) => t.id === input.choice)?.id ?? "cedar-privacy") as FenceTypeId;
  const def = fenceType(type);
  const wanted = n(ans.height, def?.defaultHeightFt ?? 6);
  const heights: readonly number[] = def?.heightsFt ?? [4, 6, 8];
  const heightFt = heights.includes(wanted) ? wanted : heights.reduce((best, h) => (Math.abs(h - wanted) < Math.abs(best - wanted) ? h : best), heights[0]);
  const gates = clampN(Math.round(n(ans.gates, 1)), 0, 6), doubles = clampN(Math.round(n(ans.double, 0)), 0, 3);
  const book = await fenceBook(shop.id, fullAddress(a));
  const { wastePct, ...opts } = book;
  const layout = {
    type, heightFt, runs: typedRuns([feet]),
    openings: [...Array.from({ length: gates }, () => ({ widthFt: 4, kind: "gate" as const, variant: "single" })), ...Array.from({ length: doubles }, () => ({ widthFt: 10, kind: "gate" as const, variant: "double" }))],
    terrain: "flat" as const, wastePct,
  };
  const pkg = priceFencePackage(layout, opts);
  const gateWords = [gates ? `${gates} walk gate${gates > 1 ? "s" : ""}` : "", doubles ? `${doubles} double gate${doubles > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ");
  const summary = `${feet.toLocaleString("en-US")} ft of fence, ${heightFt} ft high${gateWords ? `, ${gateWords}` : ""} — about ${dollars(pkg.pricePerLf)} a foot installed.`;
  return { ok: true, summary, choice: def?.label ?? type, cents: Math.round(pkg.subtotal * 100), ...p, facts: { feet, type, heightFt, gates, doubles, pricePerLf: pkg.pricePerLf, netFenceLf: pkg.netFenceLf } };
}

// FENCE STUDIO ON THE WEBSITE (2026-10-28): the homeowner draws the fence on their lot (components/estimator/fence
// FenceDrawMap); this prices the runs they drew, in the style and height they picked, with their gates, in the shop's
// book — the same engine the dashboard's studio uses.
export interface WebFenceDrawn { address: WebAddress; runsFt: number[]; type: string; heightFt: number; gates: number; doubles: number; /** Drawn on the map (false: the feet were typed). */ drawn?: boolean }

export async function priceWebFenceDrawn(shop: WebShop, d: WebFenceDrawn): Promise<WebTradeOutcome> {
  const a = d.address, p = parts(a);
  const feet = Math.round(d.runsFt.filter((n) => Number.isFinite(n) && n > 0).reduce((s, n) => s + n, 0));
  if (feet < 10) return { ok: false, error: "Draw the fence line first — at least a short run.", code: "input" };
  const book = await fenceBook(shop.id, fullAddress(a));
  const { wastePct, ...opts } = book;
  const allowed = webTradeChoices(shop, "fence");
  const type = allowed.find((c) => c.id === d.type)?.id ?? allowed[0]?.id ?? "cedar-privacy";
  const def = FENCE_TYPES.find((t) => t.id === type);
  const heightFt = [4, 5, 6, 8].includes(d.heightFt) ? d.heightFt : 6;
  const gates = clampN(Math.round(d.gates), 0, 12), doubles = clampN(Math.round(d.doubles), 0, 6);
  const layout = {
    type, heightFt, runs: typedRuns(d.runsFt.filter((n) => Number.isFinite(n) && n > 0)),
    openings: [...Array.from({ length: gates }, () => ({ widthFt: 4, kind: "gate" as const, variant: "single" })), ...Array.from({ length: doubles }, () => ({ widthFt: 10, kind: "gate" as const, variant: "double" }))],
    terrain: "flat" as const, wastePct,
  };
  const pkg = priceFencePackage(layout, opts);
  const gateWords = [gates ? `${gates} walk gate${gates > 1 ? "s" : ""}` : "", doubles ? `${doubles} double gate${doubles > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ");
  const runs = d.runsFt.filter((n) => n > 0).length;
  const where = d.drawn === false ? "" : ` drawn on the lot in ${runs} run${runs === 1 ? "" : "s"}`;
  const summary = `${feet.toLocaleString("en-US")} ft of fence${where}, ${heightFt} ft high${gateWords ? `, ${gateWords}` : ""} — about ${dollars(pkg.pricePerLf)} a foot installed.`;
  return { ok: true, summary, choice: def?.label ?? type, cents: Math.round(pkg.subtotal * 100), ...p, facts: { feet, runsFt: d.runsFt, type, heightFt, gates, doubles, pricePerLf: pkg.pricePerLf, netFenceLf: pkg.netFenceLf, drawn: d.drawn !== false } };
}

// DECK STUDIO ON THE WEBSITE (2026-10-28): the homeowner designs in the client designer (components/v3/deck-client-design);
// this prices WHAT THEY DESIGNED in the shop's rate book — the same engine, the same book, the shop's regional site.

/** The blank deck a website visitor starts from: the classic sample on this address's site, as a blank start. */
export function webDeckBase(shop: WebShop, address: string): DeckDesign {
  const state = stateOfTyped(address) ?? shop.state;
  const sample = sampleById("deck-classic") ?? DECK_SAMPLES[0];
  const base = sampleDesign(sample, defaultDeckDesign({ state }));
  const site = siteFromAddress(address, state);
  return applyDeckPatch(base, { loadPsf: site.deckLoad, frostIn: site.frostIn, site: { ...base.site, groundSnowPsf: site.groundSnowPsf, termite: site.termite } } as Parameters<typeof applyDeckPatch>[1]);
}

/** "…, Kirkland, WA 98033" → "WA" (a typed address; null when no state is in it). */
function stateOfTyped(address: string): string | null {
  const m = address.match(/,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
  return m ? m[1].toUpperCase() : null;
}

export interface WebDeckPriced { design: DeckDesign; cents: number; summary: string; choice: string; areaSqFt: number; pricePerSqFt: number }

/** The designed deck, settled to the code tables and priced in the shop's book. */
export async function priceWebDeckDesign(shop: WebShop, raw: DeckDesign, address: string): Promise<WebDeckPriced> {
  const state = stateOfTyped(address) ?? shop.state ?? raw.site.state;
  const site = siteFromAddress(address, state);
  let design = applyDeckPatch(raw, { loadPsf: site.deckLoad, frostIn: site.frostIn, site: { ...raw.site, groundSnowPsf: site.groundSnowPsf, termite: site.termite } } as Parameters<typeof applyDeckPatch>[1]);
  const market = resolveMarket({ address });
  const rates = await readDeckRateBook(shop.id);
  design = settleDesign(design, { rates, market }).design;
  const pkg = priceDeck(design, { rates, market });
  const boards = DECKING.find((d) => d.id === design.decking.product)?.label ?? design.decking.product;
  const words = structureWords(design);
  const summary = `${words.charAt(0).toUpperCase()}${words.slice(1)} (${Math.round(pkg.areaSqFt)} sq ft), ${boards.toLowerCase()} boards — about ${dollars(pkg.pricePerSqFt)} a square foot.`;
  return { design, cents: Math.round(pkg.subtotal * 100), summary, choice: boards, areaSqFt: pkg.areaSqFt, pricePerSqFt: pkg.pricePerSqFt };
}

// DECK — a starting layout, sized and dressed → the engine's package in the shop's rate book

async function deckEstimate(shop: WebShop, input: WebTradeInput): Promise<WebTradeOutcome> {
  const a = input.address, p = parts(a), ans = input.answers ?? {};
  const state = p.state || shop.state;
  const sample = sampleById(input.choice || "") ?? sampleById("deck-classic");
  if (!sample) return { ok: false, error: "Pick a deck to start from.", code: "input" };
  let design: DeckDesign = sampleDesign(sample, defaultDeckDesign({ state }));
  const widthFt = clampN(Math.round(n(ans.width, design.shape.widthFt)), 8, 40), depthFt = clampN(Math.round(n(ans.depth, design.shape.depthFt)), 6, 30);
  const heightIn = [14, 24, 36, 96].includes(n(ans.height, -1)) ? n(ans.height, 36) : design.heightIn;
  const boards = DECKING.find((d) => d.id === String(ans.boards))?.id ?? defaultDecking(state);
  const railId = RAIL_TYPES.find((r) => r.id === String(ans.rail))?.id ?? design.rail.type;
  const site = siteFromAddress(fullAddress(a), state);
  design = applyDeckPatch(design, {
    shape: { ...design.shape, widthFt, depthFt } as DeckDesign["shape"],
    heightIn: heightIn as DeckDesign["heightIn"],
    decking: { ...design.decking, product: boards },
    rail: { ...design.rail, type: railId as DeckDesign["rail"]["type"] },
    loadPsf: site.deckLoad, frostIn: site.frostIn, site: { ...design.site, groundSnowPsf: site.groundSnowPsf, termite: site.termite },
  } as Parameters<typeof applyDeckPatch>[1]);
  const market = resolveMarket({ address: fullAddress(a) });
  const rates = await readDeckRateBook(shop.id);
  design = settleDesign(design, { rates, market }).design;
  const pkg = priceDeck(design, { rates, market });
  const boardWords = DECKING.find((d) => d.id === boards)?.label ?? boards;
  const railWords = RAIL_TYPES.find((r) => r.id === railId)?.label ?? railId;
  const summary = `A ${widthFt} × ${depthFt} ft ${sample.name.toLowerCase()} (${Math.round(pkg.areaSqFt)} sq ft), ${Math.round(heightIn / 12 * 10) / 10} ft off the ground, ${boardWords.toLowerCase()} boards, ${railWords.toLowerCase()} railing — about ${dollars(pkg.pricePerSqFt)} a square foot.`;
  return { ok: true, summary, choice: `${sample.name} · ${boardWords}`, cents: Math.round(pkg.subtotal * 100), ...p, facts: { sampleId: sample.id, widthFt, depthFt, heightIn, boards, rail: railId, areaSqFt: pkg.areaSqFt, pricePerSqFt: pkg.pricePerSqFt, design } };
}
